"use client";

/**
 * Unified landing page — the SINGLE entry point for scoring a submission.
 *
 * Flow:
 *   1. User fills form (track + URL + optional team/user/repo/stats)
 *   2. POST /api/submissions → { id }
 *   3. Fire POST /api/submissions/[id]/run (no await)
 *   4. Poll GET /api/submissions/[id] every 2s until status !== "pending"
 *   5. Render result inline
 *
 * Team name and Your name are OPTIONAL on this page (default to
 * "Anonymous" / "—" server-side). A mentor running a quick judgement
 * doesn't need to fill them. Teams submitting for the leaderboard do.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TRACK_META,
  TrackId,
  getTrackMeta,
  levelNumber,
  type RubricLabel,
} from "@/lib/rubric-meta";

type ScoreCell = { level: string; evidence: string };

type Submission = {
  id?: string;
  teamName?: string;
  userName?: string;
  liveUrl?: string;
  repoUrl?: string | null;
  track?: TrackId;
  stats?: any;
  status?: "pending" | "scored" | "failed";
  scores: Record<string, ScoreCell>;
  total: number;
  maxTotal: number;
  verdict: "NOMINATE" | "CUT";
  pitch: string;
  reasoning?: string;
  traceUrl?: string;
  error?: string;
  rank?: number | null;
};

/**
 * Honest ClawStand self-score. Shown before any real run.
 * total = (3-1)*20 + (4-1)*5 + (2-1)*7 + (1-1)*5 + (2-1)*2 + (3-1)*1 + (3-1)*1 = 68
 */
const SAMPLE: Submission = {
  track: "maas",
  scores: {
    realOutputShipping: {
      level: "L3",
      evidence:
        "Working product that scores submissions from a URL. Used end-to-end in testing, not yet in active use by external judges.",
    },
    taskDecompositionQuality: {
      level: "L4",
      evidence:
        "Three named specialist agents — Product Inspector, Repo Auditor, Pitch Writer — with typed JSON contracts and independently testable steps.",
    },
    observability: {
      level: "L2",
      evidence:
        "Scattered console.log statements prefixed with [repoAuditor]. No structured tracing or Langfuse integration yet.",
    },
    evaluationAndIterationTooling: {
      level: "L1",
      evidence:
        "No eval suite. Prompt changes judged by eye only. No regression tracking across versions.",
    },
    agentHandoffsAndMemory: {
      level: "L2",
      evidence:
        "Handoffs exist — scores object passed from auditor to pitch writer — but there is no memory across runs.",
    },
    costAndLatencyOnJudgeTask: {
      level: "L3",
      evidence:
        "~30 seconds end-to-end with three Claude Sonnet 4.5 calls. Estimated well under $0.10 per judgment.",
    },
    managementUIUsability: {
      level: "L3",
      evidence:
        "Functional single-page UI. A non-developer can paste a URL, click, and see a verdict without help.",
    },
  },
  total: 68,
  maxTotal: 164,
  verdict: "CUT",
  pitch:
    "I'd love to tell you ClawStand nominates itself. It doesn't. Here's the honest ledger: we ship a real product — L3 on the root parameter. Mentors paste a URL and get a verdict in thirty seconds at sub-ten-cent cost. Task decomposition is L4: three named specialists, typed contracts, each step testable on its own. But we fail the discipline bar. Zero evals. No regression tests on the prompts. Observability is console logs and nothing more. No Langfuse. No traces. No memory across runs. Sixty-eight out of one-sixty-four. Below the fifty-percent threshold. If ClawStand stood before ClawStand, it would say: build the eval harness, wire the tracing, come back next week. Cut.",
  reasoning:
    "ClawStand ships a working product (L3 root) and decomposes its pipeline cleanly (L4), but it lacks the discipline layer — evals, tracing, durable memory — that separates hackathon work from operational production. 68/164 falls below the 82 nominate threshold.",
  liveUrl: "https://clawstand.vercel.app",
  repoUrl: "https://github.com/prjwl16/clawStand",
};

const PHASES = [
  "Queued — waiting for a slot",
  "Fetching the live product",
  "Agents reading the submission",
  "Scoring against the rubric",
  "Pitch writer composing the verdict",
];

// Smaller stagger than /submit had — the unified page is the main demo
// path, typical usage is ≤5 concurrent runs, not 60.
const MAX_QUEUE_DELAY_MS = 3000;

export default function Page() {
  const [teamName, setTeamName] = useState("");
  const [userName, setUserName] = useState("");
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [track, setTrack] = useState<TrackId>("maas");
  const [stats, setStats] = useState({
    impressions: "",
    reactions: "",
    visitors: "",
    signups: "",
    amplification: "",
    revenueUSD: "",
    waitlist: "",
  });

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const resultsRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  function cleanup() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
    if (runTimeoutRef.current) clearTimeout(runTimeoutRef.current);
    runTimeoutRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  function buildStatsPayload() {
    if (track === "maas") return undefined;
    if (track === "virality") {
      return {
        impressions: stats.impressions ? Number(stats.impressions) : undefined,
        reactions: stats.reactions ? Number(stats.reactions) : undefined,
        visitors: stats.visitors ? Number(stats.visitors) : undefined,
        signups: stats.signups ? Number(stats.signups) : undefined,
        amplification: stats.amplification || undefined,
      };
    }
    return {
      signups: stats.signups ? Number(stats.signups) : undefined,
      revenueUSD: stats.revenueUSD ? Number(stats.revenueUSD) : undefined,
      waitlist: stats.waitlist ? Number(stats.waitlist) : undefined,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !url.trim()) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setPhase(0);
    setElapsed(0);
    startRef.current = Date.now();

    // Start the elapsed-seconds ticker.
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);

    // 1. Create submission record.
    let id: string;
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim() || undefined,
          userName: userName.trim() || undefined,
          liveUrl: url.trim(),
          repoUrl: repo.trim() || undefined,
          track,
          stats: buildStatsPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        cleanup();
        setBusy(false);
        return;
      }
      id = data.id;
    } catch (err: any) {
      setError(err?.message || "Network error");
      cleanup();
      setBusy(false);
      return;
    }

    // 2. Short stagger so a burst of simultaneous runs doesn't hit Anthropic
    //    RPM all at once. ≤3s max — small because this page is typically
    //    one-at-a-time.
    const delayMs = Math.floor(Math.random() * MAX_QUEUE_DELAY_MS);

    runTimeoutRef.current = setTimeout(() => {
      // 3. Fire-and-forget /run — the server writes status when done, we poll.
      fetch(`/api/submissions/${id}/run`, { method: "POST" }).catch(() => {
        /* poll will pick up failed status */
      });

      // Reset elapsed — queue time shouldn't count toward "scoring time".
      startRef.current = Date.now();
      setElapsed(0);
      setPhase(1);
      phaseTimers.current = [
        setTimeout(() => setPhase(2), 4000),
        setTimeout(() => setPhase(3), 14000),
        setTimeout(() => setPhase(4), 26000),
      ];

      // 4. Poll until scored or failed.
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/submissions/${id}`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const sub: Submission = await res.json();
          if (sub.status === "pending") return;

          cleanup();
          setBusy(false);
          if (sub.status === "failed") {
            setError(sub.error || "Scoring failed.");
          } else {
            setResult(sub);
          }
        } catch {
          /* swallow transient errors; keep polling */
        }
      }, 2000);
    }, delayMs);
  }

  const showingSample = !result && !busy && !error;

  return (
    <main className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-6xl px-6 sm:px-10 pt-14 pb-20">
        {/* Tagline -------------------------------------------------- */}
        <section>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.98] text-fg">
            An AI judge
            <br />
            for hackathon submissions.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-sub max-w-xl leading-relaxed">
            Scores against the GrowthX Virality, Revenue, and MaaS rubrics.
            Writes the pitch-down verdict.
          </p>
        </section>

        {/* Input form ---------------------------------------------- */}
        <form onSubmit={submit} className="mt-10 space-y-5">
          {/* Track selector --------------------------------------- */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">Track</label>
            <div className="flex gap-2">
              {(["maas", "virality", "revenue"] as TrackId[]).map((t) => {
                const active = track === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={busy}
                    onClick={() => setTrack(t)}
                    className={
                      "flex-1 h-11 rounded-md border text-sm font-mono uppercase tracking-wider transition-colors " +
                      (active
                        ? "bg-acid border-acid text-black font-semibold"
                        : "border-line text-muted hover:text-fg hover:border-fg/30")
                    }
                  >
                    {TRACK_META[t].label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted font-mono">
              {TRACK_META[track].tag}
            </p>
          </div>

          {/* Team + User (optional) ------------------------------- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-fg">
                Team name{" "}
                <span className="text-muted font-normal">(optional)</span>
              </label>
              <Input
                value={teamName}
                disabled={busy}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Agent Avengers"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-fg">
                Your name{" "}
                <span className="text-muted font-normal">(optional)</span>
              </label>
              <Input
                value={userName}
                disabled={busy}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Ada Lovelace"
                maxLength={120}
              />
            </div>
          </div>

          {/* Live URL --------------------------------------------- */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">
              Live URL <span className="text-acid">*</span>
            </label>
            <Input
              required
              autoFocus
              type="url"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-submission.vercel.app"
            />
          </div>

          {/* Repo ------------------------------------------------- */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">
              GitHub repo{" "}
              <span className="text-muted font-normal">(optional)</span>
            </label>
            <Input
              type="url"
              value={repo}
              disabled={busy}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/team/repo"
            />
          </div>

          {/* Track-specific stats --------------------------------- */}
          {track === "virality" && (
            <div className="space-y-4 rounded-md border border-line bg-surface/50 p-5">
              <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted">
                Virality stats · self-reported
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <StatInput
                  label="Impressions"
                  helper="Total impressions (organic + ads × 0.25)"
                  value={stats.impressions}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, impressions: v })}
                  type="number"
                />
                <StatInput
                  label="Reactions & comments"
                  helper="Aggregated across platforms"
                  value={stats.reactions}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, reactions: v })}
                  type="number"
                />
                <StatInput
                  label="Visitors"
                  helper="Unique visitors to product"
                  value={stats.visitors}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, visitors: v })}
                  type="number"
                />
                <StatInput
                  label="Signups / actions"
                  helper="Email + first-use event"
                  value={stats.signups}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, signups: v })}
                  type="number"
                />
              </div>
              <StatInput
                label="Amplification notes"
                helper="Who reshared — named accounts, PH feature, press, etc."
                value={stats.amplification}
                disabled={busy}
                onChange={(v) => setStats({ ...stats, amplification: v })}
                placeholder="@founder_x (42k) reshared; picked up by TechCrunch..."
              />
            </div>
          )}

          {track === "revenue" && (
            <div className="space-y-4 rounded-md border border-line bg-surface/50 p-5">
              <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted">
                Revenue stats · self-reported
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatInput
                  label="Signups"
                  helper="Email + first-use event"
                  value={stats.signups}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, signups: v })}
                  type="number"
                />
                <StatInput
                  label="Revenue (USD)"
                  helper="Product money only, not services"
                  value={stats.revenueUSD}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, revenueUSD: v })}
                  type="number"
                />
                <StatInput
                  label="Waitlist"
                  helper="Emails without product touch"
                  value={stats.waitlist}
                  disabled={busy}
                  onChange={(v) => setStats({ ...stats, waitlist: v })}
                  type="number"
                />
              </div>
            </div>
          )}

          <div className="pt-1">
            <Button
              type="submit"
              size="xl"
              disabled={busy || !url.trim()}
              className="w-full sm:w-auto"
            >
              {busy ? "Scoring…" : "Score it"}
              {!busy && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
            </Button>
          </div>
        </form>

        {/* Loading state ------------------------------------------- */}
        {busy && <LoadingBar phase={phase} elapsed={elapsed} />}

        {/* Error state --------------------------------------------- */}
        {error && (
          <div className="mt-8 rounded-md border border-line bg-surface p-5">
            <div className="text-xs uppercase tracking-wider font-medium text-acid mb-2">
              Error
            </div>
            <div className="font-mono text-sm text-fg/90 whitespace-pre-wrap break-words">
              {error}
            </div>
            <button
              onClick={() => setError(null)}
              className="mt-4 text-xs uppercase tracking-[0.18em] text-muted hover:text-acid"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Results (real OR sample) --------------------------------- */}
        {(result || showingSample) && (
          <div
            ref={result ? resultsRef : null}
            className={result ? "mt-14 animate-fade" : "mt-16"}
          >
            {showingSample && (
              <div className="mb-8">
                <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-3">
                  Example output
                </div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
                  Here&rsquo;s ClawStand scoring itself.
                </h2>
              </div>
            )}
            <ResultView data={result || SAMPLE} />
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
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid" />
          <span className="text-sm font-semibold tracking-tight text-fg">
            ClawStand
          </span>
        </div>
        <nav className="flex items-center gap-5">
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

function StatInput({
  label,
  helper,
  value,
  disabled,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  helper?: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-fg">{label}</label>
      {helper && <p className="text-xs text-muted">{helper}</p>}
      <Input
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (type === "number" ? "0" : "")}
      />
    </div>
  );
}

function LoadingBar({ phase, elapsed }: { phase: number; elapsed: number }) {
  const pct = ((phase + 0.4) / PHASES.length) * 100;
  return (
    <div className="mt-8 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid animate-blink" />
          <span className="text-sm text-fg">{PHASES[phase]}…</span>
        </div>
        <div className="text-xs font-mono text-muted tabular-nums">
          {String(elapsed).padStart(2, "0")}s
        </div>
      </div>
      <div className="mt-4 h-[2px] bg-line overflow-hidden">
        <div
          className="h-full bg-acid transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ResultView({ data }: { data: Submission }) {
  const isNom = data.verdict === "NOMINATE";
  const meta = getTrackMeta(data.track);

  return (
    <div className="space-y-10">
      {/* Team/User line (only on real runs with team info) ------- */}
      {data.id && data.teamName && data.teamName !== "Anonymous" && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] font-medium text-muted mb-2">
              Scored · {data.teamName}
            </div>
            <div className="text-sm font-mono text-sub">
              {data.userName || "—"} · {data.liveUrl}
            </div>
          </div>
          {typeof data.rank === "number" && (
            <div className="text-xs font-mono text-muted uppercase tracking-[0.18em]">
              Rank #{data.rank} on leaderboard
            </div>
          )}
        </div>
      )}

      {/* Verdict banner ------------------------------------------- */}
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

      {/* Score ---------------------------------------------------- */}
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
          Total score · {meta.label}
        </div>
      </div>

      {/* Rubric table --------------------------------------------- */}
      <div className="border-t border-line">
        {meta.order.map((key) => (
          <RubricRow
            key={key}
            rubricKey={key}
            score={data.scores[key]}
            labels={meta.labels}
          />
        ))}
      </div>

      {/* Pitch card ----------------------------------------------- */}
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

      {/* Trace link (real runs only) ------------------------------ */}
      {data.traceUrl && (
        <div className="pt-2">
          <a
            href={data.traceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-acid transition-colors group"
          >
            <span className="uppercase tracking-[0.18em]">
              Traced via Langfuse
            </span>
            <span className="text-line group-hover:text-acid/60">·</span>
            <span>view trace</span>
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
  labels,
}: {
  rubricKey: string;
  score: ScoreCell | undefined;
  labels: Record<string, RubricLabel>;
}) {
  const meta = labels[rubricKey];
  const L = levelNumber(score?.level);
  const evidence = score?.evidence || "—";

  return (
    <div className="flex flex-col md:flex-row md:items-start md:gap-6 py-4 border-b border-line">
      {/* Weight + title */}
      <div className="flex items-start gap-3 md:w-64 shrink-0">
        <span className="text-xs font-mono text-muted tabular-nums pt-[3px] w-8 shrink-0">
          ×{meta?.weight ?? "?"}
        </span>
        <span className="text-[15px] font-medium text-fg leading-snug">
          {meta?.title ?? rubricKey}
        </span>
      </div>

      {/* Pills + evidence */}
      <div className="flex flex-col md:flex-row md:items-start md:gap-3 gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-1 shrink-0">
          {[1, 2, 3, 4, 5].map((n) => (
            <LevelPill key={n} n={n} selected={n === L} />
          ))}
        </div>
        <p className="flex-1 text-[13px] text-sub font-mono leading-relaxed min-w-0">
          {evidence}
        </p>
      </div>
    </div>
  );
}

function LevelPill({ n, selected }: { n: number; selected: boolean }) {
  const base =
    "h-7 min-w-[34px] px-2 rounded-md font-mono text-[11px] tabular-nums flex items-center justify-center transition-colors";
  if (selected) {
    return (
      <div className={base + " bg-acid text-black font-semibold"}>L{n}</div>
    );
  }
  return <div className={base + " border border-line text-muted"}>L{n}</div>;
}
