/**
 * Submission store — single JSON blob ("submissions.json") persisted via
 * Vercel Blob in production, or the local filesystem (data/submissions.json)
 * in development. All writes are serialized through an in-memory mutex so
 * two concurrent submissions can't corrupt the file.
 *
 * Ranking algorithm (the "optimized" one): after every mutation we re-sort
 * the whole array and renumber `rank` on scored items. Since every op reads
 * + writes the whole blob anyway, insertion-order tricks save no wall time;
 * the sort cost O(N log N) is dominated by network/file I/O. What matters is
 * that the comparator is well-defined with tiebreakers so ranks are stable.
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
  at: string; // ISO timestamp
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
  rank: number | null;
  notes: Note[];
  createdAt: string;
  scoredAt?: string;
  error?: string;
};

type StoreShape = { submissions: Submission[] };

// ---------- Persistence (blob in prod, file in dev) ----------

/**
 * LOCAL_FILE lives OUTSIDE the Next.js project root by default. If it sat
 * inside the tree (e.g. ./data/submissions.json), Next's dev-mode file
 * watcher would fire on every write and thrash the dynamic-route module
 * cache, causing subsequent GET /api/submissions/[id] polls to fall through
 * to /_not-found (was observed in Iteration 4 smoke testing). Overridable
 * via CLAWSTAND_DATA_FILE for anyone who wants a stable repo-local path.
 */
const LOCAL_FILE =
  process.env.CLAWSTAND_DATA_FILE ||
  path.join(os.tmpdir(), "clawstand", "submissions.json");
const BLOB_KEY = "submissions.json";

// Fall back to file-based storage when no blob token is configured. Keeps
// local dev zero-config. On Vercel prod, BLOB_READ_WRITE_TOKEN is always
// injected automatically once a Blob store is linked to the project.
function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readRaw(): Promise<StoreShape> {
  if (useBlob()) {
    // Dynamic import so the package isn't pulled into the local dev path.
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
    if (blobs.length === 0) return { submissions: [] };
    const res = await fetch(blobs[0].downloadUrl, { cache: "no-store" });
    if (!res.ok) return { submissions: [] };
    try {
      return (await res.json()) as StoreShape;
    } catch {
      return { submissions: [] };
    }
  }

  try {
    const text = await fs.readFile(LOCAL_FILE, "utf-8");
    return JSON.parse(text) as StoreShape;
  } catch (e: any) {
    if (e?.code === "ENOENT") return { submissions: [] };
    throw e;
  }
}

async function writeRaw(data: StoreShape): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(BLOB_KEY, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  // Atomic file write: tmp then rename.
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  const tmp = LOCAL_FILE + ".tmp";
  await fs.writeFile(tmp, body, "utf-8");
  await fs.rename(tmp, LOCAL_FILE);
}

// ---------- Mutex (serializes all read-modify-write ops) ----------

let lock: Promise<any> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  // Swallow errors in the chain so a failed op doesn't poison later ones.
  lock = next.catch(() => {});
  return next;
}

// ---------- Ranking ----------

/**
 * Comparator: scored items first (by total DESC, then root param DESC, then
 * createdAt ASC), then pending, then failed. Stable, total ordering.
 */
function compareSubmissions(a: Submission, b: Submission): number {
  const order = (s: SubmissionStatus) => (s === "scored" ? 0 : s === "pending" ? 1 : 2);
  if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);

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

/**
 * Sort + renumber ranks. Scored items get 1..N in comparator order; pending
 * and failed get rank = null.
 */
function reRank(data: StoreShape): StoreShape {
  data.submissions.sort(compareSubmissions);
  let n = 1;
  for (const s of data.submissions) {
    s.rank = s.status === "scored" ? n++ : null;
  }
  return data;
}

// ---------- Public API ----------

export async function createSubmission(input: {
  teamName: string;
  userName: string;
  liveUrl: string;
  repoUrl: string | null;
}): Promise<Submission> {
  return withLock(async () => {
    const data = await readRaw();
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
    data.submissions.push(sub);
    reRank(data);
    await writeRaw(data);
    return sub;
  });
}

export async function getSubmission(id: string): Promise<Submission | null> {
  const data = await readRaw();
  return data.submissions.find((s) => s.id === id) || null;
}

export async function listSubmissions(): Promise<Submission[]> {
  const data = await readRaw();
  // already sorted on write, but re-sort defensively in case of manual edits
  return [...data.submissions].sort(compareSubmissions);
}

export async function saveScored(
  id: string,
  patch: Partial<Submission>
): Promise<Submission | null> {
  return withLock(async () => {
    const data = await readRaw();
    const idx = data.submissions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    data.submissions[idx] = {
      ...data.submissions[idx],
      ...patch,
      status: "scored",
      scoredAt: new Date().toISOString(),
    };
    reRank(data);
    await writeRaw(data);
    return data.submissions.find((s) => s.id === id) || null;
  });
}

export async function saveFailed(id: string, error: string): Promise<Submission | null> {
  return withLock(async () => {
    const data = await readRaw();
    const idx = data.submissions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    data.submissions[idx] = {
      ...data.submissions[idx],
      status: "failed",
      error,
      scoredAt: new Date().toISOString(),
    };
    reRank(data);
    await writeRaw(data);
    return data.submissions.find((s) => s.id === id) || null;
  });
}

export async function addNote(
  id: string,
  mentor: string,
  text: string
): Promise<Submission | null> {
  return withLock(async () => {
    const data = await readRaw();
    const idx = data.submissions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    data.submissions[idx].notes.push({
      mentor: mentor.trim() || "mentor",
      text: text.trim(),
      at: new Date().toISOString(),
    });
    await writeRaw(data);
    return data.submissions[idx];
  });
}
