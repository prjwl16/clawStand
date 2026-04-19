"use client";

/**
 * Team submission form. Follows the design doctrine of the home page:
 * acid lime accent only, black/white axis, sharp rounded-md corners,
 * Inter sans + JetBrains Mono. Reuses Input/Button components.
 *
 * Flow:
 *   1. User fills form (team, user, live URL, repo URL)
 *   2. POST /api/submissions -> { id }
 *   3. Fire POST /api/submissions/[id]/run (no await — browser holds conn)
 *   4. Poll GET /api/submissions/[id] every 2s until status !== "pending"
 *   5. Render result with rank + verdict
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RUBRIC_ORDER, RUBRIC_LABELS, levelNumber } from "@/lib/rubric-meta";

type Submission = {
  id: string;
  teamName: string;
  userName: string;
  liveUrl: string;
  repoUrl: string | null;
  status: "pending" | "scored" | "failed";
  scores?: Record<string, { level: string; evidence: string }>;
  total?: number;
  maxTotal?: number;
  verdict?: "NOMINATE" | "CUT";
  pitch?: string;
  reasoning?: string;
  traceUrl?: string;
  rank: number | null;
  error?: string;
  createdAt: string;
  scoredAt?: string;
};

const PHASES = [
  "Queued — waiting for a slot",
  "Planner deciding which agents to run",
  "Fetching the live product",
  "Product inspector reading the page",
  "Repo auditor querying GitHub",
  "Pitch writer composing the verdict",
];

// Random stagger applied before firing the scoring call. Smooths a
// burst of 60 simultaneous submissions into a ~15s stream so we don't
// hammer Anthropic's RPM limit. Tuned for tier-2 (80k ITPM).
const MAX_QUEUE_DELAY_MS = 15000;

export default function SubmitPage() {
  const [teamName, setTeamName] = useState("");
  const [userName, setUserName] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [queueDelay, setQueueDelay] = useState(0); // planned stagger, seconds
  const [queueWaited, setQueueWaited] = useState(0); // elapsed seconds of queue wait

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const queueCountRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<number>(0);

  function cleanupTimers() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    phaseRef.current.forEach(clearTimeout);
    phaseRef.current = [];
    if (queueCountRef.current) clearInterval(queueCountRef.current);
    queueCountRef.current = null;
    if (runTimeoutRef.current) clearTimeout(runTimeoutRef.current);
    runTimeoutRef.current = null;
  }

  useEffect(() => () => cleanupTimers(), []);

  useEffect(() => {
    if (!busy) return;
    startRef.current = Date.now();
    setElapsed(0);
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => clearInterval(tick);
  }, [busy]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setSubmission(null);
    setBusy(true);
    setPhase(0);

    // Roll a random queue delay up-front so the UI can show the expected wait.
    const delayMs = Math.floor(Math.random() * MAX_QUEUE_DELAY_MS);
    const delaySec = Math.ceil(delayMs / 1000);
    setQueueDelay(delaySec);
    setQueueWaited(0);

    let id: string;
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName,
          userName,
          liveUrl,
          repoUrl: repoUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        setBusy(false);
        cleanupTimers();
        return;
      }
      id = data.id;
    } catch (err: any) {
      setError(err?.message || "Network error");
      setBusy(false);
      cleanupTimers();
      return;
    }

    // Tick up the queue-wait counter once per second so the UI isn't static.
    queueCountRef.current = setInterval(() => {
      setQueueWaited((s) => s + 1);
    }, 1000);

    // After the queue delay, fire /run (fire-and-forget) and start phase
    // progression + polling.
    runTimeoutRef.current = setTimeout(() => {
      if (queueCountRef.current) clearInterval(queueCountRef.current);
      queueCountRef.current = null;

      fetch(`/api/submissions/${id}/run`, { method: "POST" }).catch(() => {
        /* poll will pick up a "failed" status if the server wrote one */
      });

      // Reset elapsed so the counter shows *scoring* time, not total.
      startRef.current = Date.now();
      setElapsed(0);

      // Simulated phase progression — starts at phase 1 since queueing is phase 0.
      setPhase(1);
      phaseRef.current = [
        setTimeout(() => setPhase(2), 3000),
        setTimeout(() => setPhase(3), 8000),
        setTimeout(() => setPhase(4), 17000),
        setTimeout(() => setPhase(5), 27000),
      ];

      // Poll until the record is no longer pending.
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
          if (!res.ok) return;
          const sub: Submission = await res.json();
          if (sub.status === "pending") return;

          cleanupTimers();
          setSubmission(sub);
          setBusy(false);
          if (sub.status === "failed") {
            setError(sub.error || "Scoring failed.");
          }
        } catch {
          /* swallow transient errors; keep polling */
        }
      }, 2000);
    }, delayMs);
  }

  const canSubmit =
    !!teamName.trim() &&
    !!userName.trim() &&
    !!liveUrl.trim() &&
    !busy;

  return (
    <main className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-3xl px-6 sm:px-10 pt-14 pb-20">
        <section>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.02] text-fg">
            Submit your project.
          </h1>
          <p className="mt-4 text-base sm:text-lg text-sub max-w-xl leading-relaxed">
            The agents will score it on the GrowthX MaaS rubric. Expect ~40
            seconds. Don&rsquo;t close the tab.
          </p>
        </section>

        {/* Form ---------------------------------------------------- */}
        {!submission && (
          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-fg">
                  Team name <span className="text-acid">*</span>
                </label>
                <Input
                  required
                  value={teamName}
                  disabled={busy}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Agent Avengers"
                  maxLength={120}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-fg">
                  Your name <span className="text-acid">*</span>
                </label>
                <Input
                  required
                  value={userName}
                  disabled={busy}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Ada Lovelace"
                  maxLength={120}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-fg">
                Live URL <span className="text-acid">*</span>
              </label>
              <Input
                required
                type="url"
                value={liveUrl}
                disabled={busy}
                onChange={(e) => setLiveUrl(e.target.value)}
                placeholder="https://your-submission.vercel.app"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-fg">
                GitHub repo{" "}
                <span className="text-muted font-normal">(optional)</span>
              </label>
              <Input
                type="url"
                value={repoUrl}
                disabled={busy}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/team/repo"
              />
            </div>

            <div className="pt-1">
              <Button
                type="submit"
                size="xl"
                disabled={!canSubmit}
                className="w-full sm:w-auto"
              >
                {busy ? "Scoring…" : "Submit & score"}
                {!busy && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
              </Button>
            </div>
          </form>
        )}

        {/* Live progress ------------------------------------------ */}
        {busy && (
          <LoadingBar
            phase={phase}
            elapsed={elapsed}
            queueDelay={queueDelay}
            queueWaited={queueWaited}
          />
        )}

        {/* Error -------------------------------------------------- */}
        {error && !busy && (
          <div className="mt-8 rounded-md border border-line bg-surface p-5">
            <div className="text-xs uppercase tracking-wider font-medium text-acid mb-2">
              Error
            </div>
            <div className="font-mono text-sm text-fg/90 whitespace-pre-wrap break-words">
              {error}
            </div>
            <button
              onClick={() => {
                setError(null);
                setSubmission(null);
              }}
              className="mt-4 text-xs uppercase tracking-[0.18em] text-muted hover:text-acid"
            >
              Try again
            </button>
          </div>
        )}

        {/* Result ------------------------------------------------- */}
        {submission && submission.status === "scored" && (
          <div className="mt-14 animate-fade">
            <ResultView data={submission} />
            <div className="mt-10">
              <button
                onClick={() => {
                  setSubmission(null);
                  setTeamName("");
                  setUserName("");
                  setLiveUrl("");
                  setRepoUrl("");
                }}
                className="text-xs uppercase tracking-[0.18em] text-muted hover:text-acid"
              >
                Submit another →
              </button>
            </div>
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
      <div className="mx-auto max-w-5xl px-6 sm:px-10 h-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid" />
          <span className="text-sm font-semibold tracking-tight text-fg">
            ClawStand
          </span>
        </Link>
        <nav className="flex items-center gap-5">
          <span className="text-xs font-mono uppercase tracking-[0.18em] text-acid">
            Submit
          </span>
          <Link
            href="/admin"
            prefetch={false}
            className="text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-acid"
          >
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}

function LoadingBar({
  phase,
  elapsed,
  queueDelay,
  queueWaited,
}: {
  phase: number;
  elapsed: number;
  queueDelay: number;
  queueWaited: number;
}) {
  const pct = ((phase + 0.4) / PHASES.length) * 100;
  const queueing = phase === 0 && queueDelay > 0;
  const remaining = Math.max(0, queueDelay - queueWaited);
  const queuePct = queueDelay > 0 ? Math.min(100, (queueWaited / queueDelay) * 100) : 0;

  return (
    <div className="mt-8 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid animate-blink" />
          <span className="text-sm text-fg">
            {queueing ? `Queued · starting in ${remaining}s` : `${PHASES[phase]}…`}
          </span>
        </div>
        <div className="text-xs font-mono text-muted tabular-nums">
          {queueing
            ? `wait ${String(queueWaited).padStart(2, "0")}s`
            : `${String(elapsed).padStart(2, "0")}s`}
        </div>
      </div>
      <div className="mt-4 h-[2px] bg-line overflow-hidden">
        <div
          className="h-full bg-acid transition-all duration-700"
          style={{ width: `${queueing ? queuePct : pct}%` }}
        />
      </div>
      {queueing && (
        <p className="mt-3 text-[11px] font-mono text-muted leading-relaxed">
          Staggering a burst of simultaneous submissions so the agents
          don&rsquo;t rate-limit. Normal — do not reload.
        </p>
      )}
    </div>
  );
}

function ResultView({ data }: { data: Submission }) {
  const isNom = data.verdict === "NOMINATE";
  return (
    <div className="space-y-10">
      {/* Submission identity ----------------------------------- */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-2">
            Scored · {data.teamName}
          </div>
          <div className="text-sm font-mono text-sub">
            {data.userName} · {data.liveUrl}
          </div>
        </div>
        <div className="text-xs font-mono text-muted uppercase tracking-[0.18em]">
          Ranks visible on the mentor leaderboard
        </div>
      </div>

      {/* Verdict banner --------------------------------------- */}
      <div
        className={
          "w-full rounded-md flex items-center justify-center h-24 " +
          (isNom ? "bg-acid text-black" : "bg-fg text-bg")
        }
      >
        <span className="text-5xl sm:text-6xl font-bold tracking-tight">
          {data.verdict}
        </span>
      </div>

      {/* Total score ------------------------------------------ */}
      <div className="flex items-baseline justify-between gap-6 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span className="text-7xl sm:text-8xl lg:text-9xl font-extrabold tracking-tight leading-none tabular-nums text-fg">
            {data.total}
          </span>
          <span className="text-2xl sm:text-3xl font-medium text-muted tabular-nums">
            / {data.maxTotal}
          </span>
        </div>
        <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted">
          Total score
        </div>
      </div>

      {/* Rubric table ----------------------------------------- */}
      <div className="border-t border-line">
        {RUBRIC_ORDER.map((key) => (
          <RubricRow key={key} rubricKey={key} score={data.scores?.[key]} />
        ))}
      </div>

      {/* Pitch card ------------------------------------------- */}
      {data.pitch && (
        <div>
          <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-3">
            Pitch · 60s spoken
          </div>
          <div className="rounded-md bg-surface border-l-[3px] border-l-acid py-7 px-7 sm:py-8 sm:px-9">
            <p className="text-lg sm:text-[20px] leading-[1.6] text-fg">
              {data.pitch}
            </p>
          </div>
        </div>
      )}

      {/* Trace ------------------------------------------------ */}
      {data.traceUrl && (
        <div className="pt-2">
          <a
            href={data.traceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-acid transition-colors group"
          >
            <span className="uppercase tracking-[0.18em]">Traced via Langfuse</span>
            <span className="text-line group-hover:text-acid/60">·</span>
            <span>view 3 agent spans</span>
            <ArrowUpRight
              className="h-3 w-3 group-hover:translate-x-[1px] group-hover:-translate-y-[1px] transition-transform"
              strokeWidth={2}
            />
          </a>
        </div>
      )}
    </div>
  );
}

function RubricRow({
  rubricKey,
  score,
}: {
  rubricKey: string;
  score: { level: string; evidence: string } | undefined;
}) {
  const meta = RUBRIC_LABELS[rubricKey];
  const L = levelNumber(score?.level);
  const evidence = score?.evidence || "—";

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-6 py-4 border-b border-line">
      <div className="md:col-span-4 flex items-start gap-3">
        <span className="text-xs font-mono text-muted tabular-nums pt-[3px] w-8 shrink-0">
          ×{meta.weight}
        </span>
        <span className="text-[15px] font-medium text-fg leading-snug">
          {meta.title}
        </span>
      </div>
      <div className="md:col-span-3">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <LevelPill key={n} n={n} selected={n === L} />
          ))}
        </div>
      </div>
      <div className="md:col-span-5">
        <p className="text-[13px] text-sub font-mono leading-relaxed">
          {evidence}
        </p>
      </div>
    </div>
  );
}

function LevelPill({ n, selected }: { n: number; selected: boolean }) {
  const base =
    "h-7 min-w-[34px] px-2 rounded-md font-mono text-[11px] tabular-nums flex items-center justify-center transition-colors";
  if (selected)
    return <div className={base + " bg-acid text-black font-semibold"}>L{n}</div>;
  return <div className={base + " border border-line text-muted"}>L{n}</div>;
}
