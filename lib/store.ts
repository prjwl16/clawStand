/**
 * Submission store — one blob per submission, not one global blob.
 *
 * Why this matters: the previous design (single "submissions.json" blob)
 * used a module-level in-memory mutex to serialize read-modify-write. That
 * mutex only covers ONE serverless function instance. Under concurrent load
 * (e.g. 60 teams POSTing in a burst at a hackathon), Vercel spins up many
 * instances and the mutex is useless across them. Two instances read 0 items,
 * each appends their team, each writes back — the second write overwrites
 * the first. Guaranteed data loss at scale.
 *
 * Per-submission blobs fix this by making every write touch a DIFFERENT
 * pathname. Two creates don't conflict. Two notes on DIFFERENT submissions
 * don't conflict. Only two writes to the SAME submission (e.g. two mentors
 * adding notes to the same team at the exact same moment) can still race,
 * and at 60-team scale that's a non-event.
 *
 * Storage layout:
 *   submissions/<id>.json          — one file per submission, full JSON body
 *
 * Rank is NOT stored. It's computed on every listSubmissions() call by
 * sorting the fetched set with compareSubmissions and numbering scored
 * items 1..N. That keeps writes O(1) regardless of N.
 *
 * Local dev (no BLOB_READ_WRITE_TOKEN) uses one file per submission under
 * $TMPDIR/clawstand/submissions/, mirroring prod semantics.
 */
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { levelNumber } from "./rubric-meta";

// ---------- Types ----------

export type ScoreCell = { level: string; evidence: string };

export type SubmissionStatus = "pending" | "scored" | "failed";

export type Note = {
  mentor: string;
  text: string;
  at: string;
};

export type Submission = {
  id: string;
  teamName: string;
  userName: string;
  liveUrl: string;
  repoUrl: string | null;
  status: SubmissionStatus;
  scores?: Record<string, ScoreCell>;
  total?: number;
  maxTotal?: number;
  verdict?: "NOMINATE" | "CUT";
  pitch?: string;
  reasoning?: string;
  traceUrl?: string;
  plan?: any;
  rank: number | null; // populated on list, null on single-item reads
  notes: Note[];
  createdAt: string;
  scoredAt?: string;
  error?: string;
};

// ---------- Storage backend selection ----------

const BLOB_PREFIX = "submissions/";
const LOCAL_DIR =
  process.env.CLAWSTAND_DATA_DIR ||
  path.join(os.tmpdir(), "clawstand", "submissions");

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function pathnameFor(id: string): string {
  return `${BLOB_PREFIX}${id}.json`;
}

function localPathFor(id: string): string {
  return path.join(LOCAL_DIR, `${id}.json`);
}

// ---------- Single-submission read/write ----------

async function readOne(id: string): Promise<Submission | null> {
  if (useBlob()) {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: pathnameFor(id), limit: 1 });
    if (blobs.length === 0) return null;
    // Append cache-buster as backup — any blob written before we set
    // cacheControlMaxAge: 0 still has the 1-year CDN default.
    const fresh = `${blobs[0].downloadUrl}${blobs[0].downloadUrl.includes("?") ? "&" : "?"}_=${Date.now()}`;
    const res = await fetch(fresh, { cache: "no-store" });
    if (!res.ok) return null;
    try {
      return (await res.json()) as Submission;
    } catch {
      return null;
    }
  }

  try {
    const text = await fs.readFile(localPathFor(id), "utf-8");
    return JSON.parse(text) as Submission;
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

async function writeOne(sub: Submission): Promise<void> {
  const body = JSON.stringify(sub, null, 2);

  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    // cacheControlMaxAge: 0 disables the default 1-YEAR Vercel CDN cache.
    // Without this, after saveScored/saveFailed updates a blob, subsequent
    // polls will keep seeing the stale "pending" version until CDN revalidates
    // — fatal for the polling UX. See:
    // https://vercel.com/docs/storage/vercel-blob/using-blob-sdk#caching-at-the-cdn-level
    await put(pathnameFor(sub.id), body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    return;
  }

  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const file = localPathFor(sub.id);
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, body, "utf-8");
  await fs.rename(tmp, file);
}

async function listAllRaw(): Promise<Submission[]> {
  if (useBlob()) {
    const { list } = await import("@vercel/blob");
    // Blob list pagination: keep fetching pages until done. At 60-item scale
    // a single call is enough (default limit is 1000) but be defensive.
    const all: { downloadUrl: string }[] = [];
    let cursor: string | undefined;
    do {
      const res = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
      all.push(...res.blobs);
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);

    // Fetch all blob bodies in parallel, with cache-buster (same reason as readOne).
    const ts = Date.now();
    const results = await Promise.all(
      all.map(async (b) => {
        try {
          const fresh = `${b.downloadUrl}${b.downloadUrl.includes("?") ? "&" : "?"}_=${ts}`;
          const r = await fetch(fresh, { cache: "no-store" });
          if (!r.ok) return null;
          return (await r.json()) as Submission;
        } catch {
          return null;
        }
      })
    );
    return results.filter((s): s is Submission => !!s);
  }

  // Local dev: readdir + parallel readFile.
  let files: string[] = [];
  try {
    files = (await fs.readdir(LOCAL_DIR)).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".tmp")
    );
  } catch (e: any) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const text = await fs.readFile(path.join(LOCAL_DIR, f), "utf-8");
        return JSON.parse(text) as Submission;
      } catch {
        return null;
      }
    })
  );
  return results.filter((s): s is Submission => !!s);
}

// ---------- Per-submission mutex (same-instance addNote serialization) ----------
//
// Two mentors writing notes to the SAME submission within the SAME function
// instance would race without this. This map is per-instance; cross-instance
// races still exist but require two mentors typing at the exact same moment
// on the same team AND hitting different Vercel instances. Acceptable.

const subLocks = new Map<string, Promise<any>>();

function withSubLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = subLocks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  subLocks.set(
    id,
    next.catch(() => {})
  );
  next.finally(() => {
    if (subLocks.get(id) === next.catch(() => {})) subLocks.delete(id);
  });
  return next;
}

// ---------- Ranking (computed on read) ----------

function compareSubmissions(a: Submission, b: Submission): number {
  const order = (s: SubmissionStatus) =>
    s === "scored" ? 0 : s === "pending" ? 1 : 2;
  if (order(a.status) !== order(b.status))
    return order(a.status) - order(b.status);

  if (a.status === "scored" && b.status === "scored") {
    const at = a.total ?? -1;
    const bt = b.total ?? -1;
    if (bt !== at) return bt - at;

    const aRoot = levelNumber(a.scores?.realOutputShipping?.level);
    const bRoot = levelNumber(b.scores?.realOutputShipping?.level);
    if (bRoot !== aRoot) return bRoot - aRoot;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

function assignRanks(subs: Submission[]): Submission[] {
  subs.sort(compareSubmissions);
  let n = 1;
  for (const s of subs) {
    s.rank = s.status === "scored" ? n++ : null;
  }
  return subs;
}

// ---------- Public API ----------

export async function createSubmission(input: {
  teamName: string;
  userName: string;
  liveUrl: string;
  repoUrl: string | null;
}): Promise<Submission> {
  const sub: Submission = {
    id: `sub_${crypto.randomBytes(6).toString("hex")}`,
    teamName: input.teamName.trim(),
    userName: input.userName.trim(),
    liveUrl: input.liveUrl.trim(),
    repoUrl: input.repoUrl ? input.repoUrl.trim() : null,
    status: "pending",
    rank: null,
    notes: [],
    createdAt: new Date().toISOString(),
  };
  await writeOne(sub);
  return sub;
}

/**
 * Single-submission read. Used by the polling endpoint. Does NOT compute
 * rank (rank is a leaderboard concept and would require fetching all
 * submissions on every poll — a 60-items-per-2s multiplication we don't want).
 */
export async function getSubmission(id: string): Promise<Submission | null> {
  const sub = await readOne(id);
  if (!sub) return null;
  sub.rank = null; // rank is always null on single-item reads
  return sub;
}

/**
 * Full list, sorted by rank. Used by /admin. Assigns ranks in-place.
 */
export async function listSubmissions(): Promise<Submission[]> {
  const subs = await listAllRaw();
  return assignRanks(subs);
}

/**
 * Public counts for queue-position UI on /submit. Cheap — 1 list call, no
 * content fetches.
 */
export async function queueStats(): Promise<{
  pending: number;
  scored: number;
  failed: number;
  total: number;
}> {
  const subs = await listAllRaw();
  let pending = 0,
    scored = 0,
    failed = 0;
  for (const s of subs) {
    if (s.status === "scored") scored++;
    else if (s.status === "failed") failed++;
    else pending++;
  }
  return { pending, scored, failed, total: subs.length };
}

export async function saveScored(
  id: string,
  patch: Partial<Submission>
): Promise<Submission | null> {
  return withSubLock(id, async () => {
    const existing = await readOne(id);
    if (!existing) return null;
    const updated: Submission = {
      ...existing,
      ...patch,
      status: "scored",
      scoredAt: new Date().toISOString(),
    };
    await writeOne(updated);
    return updated;
  });
}

export async function saveFailed(
  id: string,
  error: string
): Promise<Submission | null> {
  return withSubLock(id, async () => {
    const existing = await readOne(id);
    if (!existing) return null;
    const updated: Submission = {
      ...existing,
      status: "failed",
      error,
      scoredAt: new Date().toISOString(),
    };
    await writeOne(updated);
    return updated;
  });
}

export async function addNote(
  id: string,
  mentor: string,
  text: string
): Promise<Submission | null> {
  return withSubLock(id, async () => {
    const existing = await readOne(id);
    if (!existing) return null;
    existing.notes.push({
      mentor: mentor.trim() || "mentor",
      text: text.trim(),
      at: new Date().toISOString(),
    });
    await writeOne(existing);
    return existing;
  });
}
