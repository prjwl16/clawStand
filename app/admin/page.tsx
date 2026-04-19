"use client";

/**
 * Admin (mentor) leaderboard. Guarded by middleware.ts with HTTP Basic Auth
 * (user: buildathon / pass: password). Lists all submissions in rank order,
 * lets mentors expand each row to see scores + evidence + pitch and to add
 * notes. Notes don't affect scores or ranking.
 *
 * Auto-refreshes every 10s so pending rows update without a manual reload.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RUBRIC_ORDER,
  RUBRIC_LABELS,
  levelNumber,
  getTrackMeta,
  type RubricLabel,
} from "@/lib/rubric-meta";

type ScoreCell = { level: string; evidence: string };
type Note = { mentor: string; text: string; at: string };

type Submission = {
  id: string;
  teamName: string;
  userName: string;
  liveUrl: string;
  repoUrl: string | null;
  status: "pending" | "scored" | "failed";
  scores?: Record<string, ScoreCell>;
  total?: number;
  maxTotal?: number;
  verdict?: "NOMINATE" | "CUT";
  pitch?: string;
  reasoning?: string;
  traceUrl?: string;
  rank: number | null;
  notes: Note[];
  error?: string;
  createdAt: string;
  scoredAt?: string;
};

export default function AdminPage() {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/submissions", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      const data = await res.json();
      setSubs(data.submissions || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Network error");
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const pendingCount = (subs || []).filter((s) => s.status === "pending").length;
  const scoredCount = (subs || []).filter((s) => s.status === "scored").length;
  const failedCount = (subs || []).filter((s) => s.status === "failed").length;

  return (
    <main className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-6xl px-6 sm:px-10 pt-10 pb-20">
        {/* Heading ------------------------------------------ */}
        <section className="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] font-medium text-acid mb-2">
              Mentor view
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.02] text-fg">
              Leaderboard.
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono uppercase tracking-[0.15em]">
            <span className="text-acid">{scoredCount} scored</span>
            <span className="text-sub">{pendingCount} pending</span>
            <span className="text-muted">{failedCount} failed</span>
            <button
              onClick={refresh}
              className="text-muted hover:text-acid"
              title="Refresh"
            >
              refresh ↻
            </button>
          </div>
        </section>

        {error && (
          <div className="mb-6 rounded-md border border-line bg-surface p-4">
            <div className="text-xs uppercase tracking-wider font-medium text-acid mb-1">
              Error
            </div>
            <div className="font-mono text-sm text-fg/90">{error}</div>
          </div>
        )}

        {/* Table -------------------------------------------- */}
        {subs && subs.length === 0 && (
          <div className="rounded-md border border-line bg-surface p-10 text-center">
            <div className="text-sub">
              No submissions yet.{" "}
              <Link href="/submit" className="text-acid hover:underline">
                Submit one →
              </Link>
            </div>
          </div>
        )}

        {subs && subs.length > 0 && (
          <div className="border-t border-line">
            {/* Column headers */}
            <div className="hidden md:grid grid-cols-12 gap-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted border-b border-line">
              <div className="col-span-1">Rank</div>
              <div className="col-span-3">Team · User</div>
              <div className="col-span-3">Live URL</div>
              <div className="col-span-1 text-right">Score</div>
              <div className="col-span-2">Verdict</div>
              <div className="col-span-2 text-right">Notes · Status</div>
            </div>

            {subs.map((s) => (
              <SubmissionRow
                key={s.id}
                sub={s}
                isOpen={expanded === s.id}
                onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                onMutated={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 sm:px-10 h-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid" />
          <span className="text-sm font-semibold tracking-tight text-fg">
            ClawStand
          </span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/submit"
            className="text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-acid"
          >
            Submit
          </Link>
          <span className="text-xs font-mono uppercase tracking-[0.18em] text-acid">
            Admin
          </span>
        </nav>
      </div>
    </header>
  );
}

function SubmissionRow({
  sub,
  isOpen,
  onToggle,
  onMutated,
}: {
  sub: Submission;
  isOpen: boolean;
  onToggle: () => void;
  onMutated: () => void;
}) {
  const isNom = sub.verdict === "NOMINATE";
  const isScored = sub.status === "scored";

  // Rerun state lives on the row so both the row-header icon button and the
  // expanded ActionsBar can share busy/error state without double-firing.
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunErr, setRerunErr] = useState<string | null>(null);
  const canRerun = sub.status === "scored" || sub.status === "failed";

  function rerun() {
    if (rerunBusy || !canRerun) return;
    setRerunBusy(true);
    setRerunErr(null);
    // Fire-and-forget — the route writes pending status before it kicks off
    // the ~30s pipeline, so a quick refresh shortly after will flip the row
    // to "scoring…" and the page's 10s polling takes it from there.
    fetch(`/api/submissions/${sub.id}/run`, { method: "POST" }).catch(() => {
      setRerunErr("Network error");
    });
    setTimeout(() => {
      onMutated();
      setRerunBusy(false);
    }, 800);
  }

  return (
    <div className="border-b border-line">
      {/* Summary row — div role=button so anchor children are legal HTML */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 py-4 text-left hover:bg-surface transition-colors cursor-pointer focus:outline-none focus-visible:bg-surface"
      >
        {/* Rank */}
        <div className="md:col-span-1 flex items-baseline gap-2">
          {sub.rank != null ? (
            <span className="text-xl font-extrabold tracking-tight tabular-nums text-fg">
              {sub.rank}
            </span>
          ) : (
            <span className="text-sm font-mono text-muted">—</span>
          )}
        </div>

        {/* Team */}
        <div className="md:col-span-3 min-w-0">
          <div className="font-medium text-fg truncate">{sub.teamName}</div>
          <div className="text-xs font-mono text-muted truncate">
            {sub.userName}
          </div>
        </div>

        {/* URLs — clickable, open in new tab, don't toggle the row */}
        <div className="md:col-span-3 min-w-0">
          <a
            href={sub.liveUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            title={sub.liveUrl}
            className="block text-xs font-mono text-sub truncate hover:text-acid hover:underline transition-colors"
          >
            {sub.liveUrl.replace(/^https?:\/\//, "")}
          </a>
          {sub.repoUrl && (
            <a
              href={sub.repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              title={sub.repoUrl}
              className="block text-xs font-mono text-muted truncate hover:text-acid hover:underline transition-colors"
            >
              {sub.repoUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>

        {/* Score */}
        <div className="md:col-span-1 text-right">
          {isScored ? (
            <span className="text-xl font-extrabold tabular-nums text-fg">
              {sub.total}
            </span>
          ) : (
            <span className="text-xs font-mono text-muted">—</span>
          )}
        </div>

        {/* Verdict */}
        <div className="md:col-span-2">
          {isScored && sub.verdict && (
            <span
              className={
                "inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold tracking-tight " +
                (isNom ? "bg-acid text-black" : "bg-fg text-bg")
              }
            >
              {sub.verdict}
            </span>
          )}
          {sub.status === "pending" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-sub">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid animate-blink" />
              scoring…
            </span>
          )}
          {sub.status === "failed" && (
            <span className="text-xs font-mono uppercase tracking-[0.15em] text-muted">
              failed
            </span>
          )}
        </div>

        {/* Notes / rerun / chevron */}
        <div className="md:col-span-2 flex items-center justify-end gap-3">
          {sub.notes.length > 0 && (
            <span className="text-xs font-mono text-muted">
              {sub.notes.length} note{sub.notes.length === 1 ? "" : "s"}
            </span>
          )}
          {canRerun && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                rerun();
              }}
              disabled={rerunBusy}
              title={rerunBusy ? "Rerunning agents…" : "Rerun agents"}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted hover:text-acid hover:bg-line transition-colors disabled:opacity-50 disabled:hover:text-muted disabled:hover:bg-transparent"
            >
              <RotateCw
                className={"h-3.5 w-3.5 " + (rerunBusy ? "animate-spin text-acid" : "")}
                strokeWidth={2}
              />
              <span className="sr-only">Rerun agents</span>
            </button>
          )}
          <ChevronDown
            className={
              "h-4 w-4 text-muted transition-transform " +
              (isOpen ? "rotate-180 text-acid" : "")
            }
            strokeWidth={2}
          />
        </div>
      </div>

      {/* Expanded body ------------------------------------- */}
      {isOpen && (
        <div className="pb-8 pt-2 animate-fade">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Left: scores + pitch */}
            <div className="lg:col-span-3 space-y-6">
              {sub.status === "failed" && (
                <div className="rounded-md border border-line bg-surface p-4">
                  <div className="text-xs uppercase tracking-wider font-medium text-acid mb-2">
                    Scoring failed
                  </div>
                  <div className="font-mono text-sm text-fg/90 whitespace-pre-wrap break-words">
                    {sub.error || "Unknown error"}
                  </div>
                </div>
              )}

              {sub.status === "scored" && sub.scores && (() => {
                const meta = getTrackMeta((sub as any).track);
                return (
                  <div className="border-t border-line">
                    {meta.order.map((key) => (
                      <MiniRubricRow
                        key={key}
                        rubricKey={key}
                        score={sub.scores![key]}
                        labels={meta.labels}
                      />
                    ))}
                  </div>
                );
              })()}

              {sub.pitch && (
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-2">
                    Pitch · 60s spoken
                  </div>
                  <div className="rounded-md bg-surface border-l-[3px] border-l-acid py-5 px-5">
                    <p className="text-sm leading-relaxed text-fg">{sub.pitch}</p>
                  </div>
                </div>
              )}

              <ActionsBar
                sub={sub}
                canRerun={canRerun}
                rerunBusy={rerunBusy}
                rerunErr={rerunErr}
                onRerun={rerun}
              />
            </div>

            {/* Right: notes */}
            <div className="lg:col-span-2">
              <NotesPanel sub={sub} onAdded={onMutated} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniRubricRow({
  rubricKey,
  score,
  labels,
}: {
  rubricKey: string;
  score: ScoreCell | undefined;
  labels?: Record<string, RubricLabel>;
}) {
  const meta = (labels || RUBRIC_LABELS)[rubricKey];
  const L = levelNumber(score?.level);
  return (
    <div className="grid grid-cols-12 gap-3 py-2.5 border-b border-line">
      <div className="col-span-4 flex items-baseline gap-2">
        <span className="text-[10px] font-mono text-muted tabular-nums pt-[2px] w-7">
          ×{meta?.weight ?? "?"}
        </span>
        <span className="text-[13px] font-medium text-fg leading-snug">
          {meta?.title ?? rubricKey}
        </span>
      </div>
      <div className="col-span-3 flex items-center">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = n === L;
            return (
              <div
                key={n}
                className={
                  "h-5 min-w-[24px] px-1.5 rounded-sm font-mono text-[10px] tabular-nums flex items-center justify-center " +
                  (selected
                    ? "bg-acid text-black font-semibold"
                    : "border border-line text-muted")
                }
              >
                L{n}
              </div>
            );
          })}
        </div>
      </div>
      <div className="col-span-5">
        <p className="text-[12px] text-sub font-mono leading-relaxed">
          {score?.evidence || "—"}
        </p>
      </div>
    </div>
  );
}

/**
 * Bottom-of-expanded-row toolbar. Surfaces the Langfuse trace link and a
 * labeled "Rerun agents" action that mirrors the icon-button in the row
 * header — both bind to the same lifted state in SubmissionRow so they
 * stay in sync (clicking either flips both into the busy state).
 */
function ActionsBar({
  sub,
  canRerun,
  rerunBusy,
  rerunErr,
  onRerun,
}: {
  sub: Submission;
  canRerun: boolean;
  rerunBusy: boolean;
  rerunErr: string | null;
  onRerun: () => void;
}) {
  if (!canRerun && !sub.traceUrl) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-2">
      {sub.traceUrl && (
        <a
          href={sub.traceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-acid transition-colors group"
        >
          <span className="uppercase tracking-[0.18em]">Langfuse trace</span>
          <ArrowUpRight
            className="h-3 w-3 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] transition-transform"
            strokeWidth={2}
          />
        </a>
      )}

      {canRerun && (
        <button
          onClick={onRerun}
          disabled={rerunBusy}
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-acid transition-colors disabled:opacity-50 disabled:hover:text-muted"
          title="Re-run all agents and recompute the score"
        >
          <RotateCw
            className={"h-3 w-3 " + (rerunBusy ? "animate-spin text-acid" : "")}
            strokeWidth={2}
          />
          <span>{rerunBusy ? "rerunning…" : "rerun agents"}</span>
        </button>
      )}

      {rerunErr && (
        <span className="text-xs font-mono text-acid normal-case">{rerunErr}</span>
      )}
    </div>
  );
}

function NotesPanel({
  sub,
  onAdded,
}: {
  sub: Submission;
  onAdded: () => void;
}) {
  const [mentor, setMentor] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/submissions/${sub.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentor: mentor.trim() || "mentor", text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
      } else {
        setText("");
        onAdded();
      }
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-3">
        Mentor notes
      </div>

      {/* Existing notes */}
      <div className="space-y-3 mb-5 max-h-80 overflow-y-auto">
        {sub.notes.length === 0 && (
          <div className="text-xs font-mono text-muted italic">
            No notes yet.
          </div>
        )}
        {sub.notes.map((n, i) => (
          <div
            key={i}
            className="rounded-md border border-line bg-surface p-3"
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs font-mono uppercase tracking-[0.12em] text-acid">
                {n.mentor}
              </span>
              <span className="text-[10px] font-mono text-muted tabular-nums">
                {new Date(n.at).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">
              {n.text}
            </p>
          </div>
        ))}
      </div>

      {/* Add note form */}
      <div className="space-y-3">
        <Input
          value={mentor}
          disabled={busy}
          onChange={(e) => setMentor(e.target.value)}
          placeholder="Mentor name (optional)"
          maxLength={60}
        />
        <textarea
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note about this submission…"
          rows={4}
          maxLength={4000}
          className="w-full bg-surface text-fg placeholder:text-muted border border-line rounded-md px-4 py-3 text-sm font-mono focus:outline-none focus:border-acid focus:ring-1 focus:ring-acid transition-colors disabled:opacity-50"
        />
        {err && (
          <div className="text-xs font-mono text-acid">{err}</div>
        )}
        <Button
          onClick={add}
          disabled={busy || !text.trim()}
          size="sm"
          className="w-full sm:w-auto"
        >
          {busy ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
