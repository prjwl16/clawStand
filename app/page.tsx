"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RUBRIC_ORDER, RUBRIC_LABELS, levelNumber } from "@/lib/rubric-meta";

type ScoreCell = { level: string; evidence: string };

type ScoreResult = {
  scores: Record<string, ScoreCell>;
  total: number;
  maxTotal: number;
  verdict: "NOMINATE" | "CUT";
  pitch: string;
  reasoning: string;
  inputs: { url: string; repo: string | null };
};

/**
 * Honest ClawStand self-score. Shown before any real run so passers-by can
 * understand the product at a glance. Deliberately CUT — the judge cuts itself
 * when its own discipline layer doesn't meet the bar.
 *   total = (3-1)*20 + (4-1)*5 + (2-1)*7 + (1-1)*5 + (2-1)*2 + (3-1)*1 + (3-1)*1
 *         = 40 + 15 + 7 + 0 + 2 + 2 + 2 = 68
 */
const SAMPLE: ScoreResult = {
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
  inputs: {
    url: "https://clawstand.vercel.app",
    repo: "https://github.com/prjwl16/clawStand",
  },
};

const PHASES = [
  "Fetching the live product",
  "Product inspector reading the page",
  "Repo auditor querying GitHub",
  "Pitch writer composing the verdict",
];

export default function Page() {
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<number>(0);

  // Phase cycler so the ~30s wait shows movement.
  useEffect(() => {
    if (!loading) return;
    setPhase(0);
    setElapsed(0);
    startRef.current = Date.now();
    const timers = [
      setTimeout(() => setPhase(1), 2500),
      setTimeout(() => setPhase(2), 9000),
      setTimeout(() => setPhase(3), 20000),
    ];
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(tick);
    };
  }, [loading]);

  useEffect(() => {
    if (result && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          repo: repo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  const showingSample = !result && !loading && !error;

  return (
    <main className="min-h-screen">
      <Header />

      <div className="mx-auto max-w-5xl px-6 sm:px-10 pt-16 pb-20">
        {/* Tagline + subtext --------------------------------------- */}
        <section className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] text-fg">
            An AI judge for hackathon submissions.
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-sub leading-relaxed max-w-2xl">
            Scores against the GrowthX MaaS rubric. Writes the mentor
            pitch-down verdict.
          </p>
        </section>

        {/* Input form ---------------------------------------------- */}
        <form onSubmit={submit} className="mt-12 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">
              Live URL <span className="text-cut">*</span>
            </label>
            <Input
              required
              autoFocus
              value={url}
              disabled={loading}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-submission.vercel.app"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">
              GitHub repo{" "}
              <span className="text-muted font-normal">(optional)</span>
            </label>
            <Input
              value={repo}
              disabled={loading}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/team/repo"
            />
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              size="xl"
              disabled={loading || !url.trim()}
              className="w-full sm:w-auto"
            >
              {loading ? "Scoring…" : "Score it"}
              {!loading && <ArrowRight className="h-5 w-5" strokeWidth={2.5} />}
            </Button>
          </div>
        </form>

        {/* Loading state ------------------------------------------- */}
        {loading && <LoadingBar phase={phase} elapsed={elapsed} />}

        {/* Error box ------------------------------------------------ */}
        {error && (
          <div className="mt-10 rounded-xl border border-cut/60 bg-cut/5 p-6">
            <div className="text-sm font-medium text-cut mb-2">
              Scoring failed
            </div>
            <div className="font-mono text-sm text-cut/90 whitespace-pre-wrap break-words">
              {error}
            </div>
          </div>
        )}

        {/* Results (real OR sample) --------------------------------- */}
        {(result || showingSample) && (
          <div ref={result ? resultsRef : null} className={result ? "mt-16 animate-fade" : "mt-20"}>
            {showingSample && <SampleIntro />}
            <ResultView data={result || SAMPLE} />
          </div>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*   Sections                                                         */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto max-w-5xl px-6 sm:px-10 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-acid" />
          <span className="text-base font-medium tracking-tight text-fg">
            ClawStand
          </span>
        </div>
        <div className="text-xs sm:text-sm text-sub">
          MaaS rubric <span className="text-muted">·</span> 164 max
        </div>
      </div>
    </header>
  );
}

function SampleIntro() {
  return (
    <div className="mb-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-sub mb-4">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid" />
        Sample output
      </div>
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
        See it in action: here&rsquo;s ClawStand scoring itself.
      </h2>
      <p className="mt-2 text-sub">
        Below is what a real judgment looks like. Paste a URL above to run
        your own.
      </p>
    </div>
  );
}

function LoadingBar({ phase, elapsed }: { phase: number; elapsed: number }) {
  return (
    <div className="mt-8 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-acid animate-blink" />
          <span className="text-sm text-fg">{PHASES[phase]}…</span>
        </div>
        <div className="text-xs font-mono text-muted">
          step {phase + 1} of {PHASES.length} · {String(elapsed).padStart(2, "0")}s
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {PHASES.map((_, i) => (
          <div
            key={i}
            className={
              "h-[3px] rounded-full transition-colors " +
              (i < phase
                ? "bg-acid"
                : i === phase
                ? "bg-acid/50 animate-pulse"
                : "bg-line")
            }
          />
        ))}
      </div>
    </div>
  );
}

function ResultView({ data }: { data: ScoreResult }) {
  const pct = Math.round((data.total / data.maxTotal) * 100);
  const isNom = data.verdict === "NOMINATE";

  return (
    <div className="space-y-10">
      {/* Verdict banner */}
      <div
        className={
          "w-full rounded-xl flex items-center justify-center h-[72px] sm:h-20 " +
          (isNom ? "bg-nom text-black" : "bg-cut text-white")
        }
      >
        <span className="text-4xl sm:text-5xl font-bold tracking-wide">
          {data.verdict}
        </span>
      </div>

      {/* Score */}
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Total score
          </div>
          <div className="flex items-end gap-3">
            <span className="text-7xl sm:text-8xl lg:text-9xl font-bold tracking-tight leading-none tabular-nums text-fg">
              {data.total}
            </span>
            <span className="text-3xl sm:text-4xl font-semibold text-muted pb-2 sm:pb-3 tabular-nums">
              / {data.maxTotal}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            {pct}% of max
          </div>
          <div className="w-48 h-1.5 rounded-full bg-line overflow-hidden">
            <div
              className={
                "h-full rounded-full " + (isNom ? "bg-nom" : "bg-cut")
              }
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted">
            Nominate bar: 82 / 164 (50%)
          </div>
        </div>
      </div>

      {/* Rubric table */}
      <div className="rounded-xl border border-line overflow-hidden">
        <div className="hidden md:grid grid-cols-12 gap-6 px-6 py-3 border-b border-line bg-surface text-xs uppercase tracking-wider text-muted">
          <div className="col-span-4">Parameter</div>
          <div className="col-span-3">Level</div>
          <div className="col-span-5">Evidence</div>
        </div>
        {RUBRIC_ORDER.map((key, idx) => (
          <RubricRow
            key={key}
            rubricKey={key}
            score={data.scores[key]}
            isLast={idx === RUBRIC_ORDER.length - 1}
          />
        ))}
      </div>

      {/* Pitch card */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-3">
          The pitch <span className="text-line">·</span> read aloud, ~60 seconds
        </div>
        <div className="rounded-xl border border-line bg-surface p-8 sm:p-10 border-l-[6px] border-l-acid">
          <p className="text-lg sm:text-[20px] leading-[1.65] text-fg">
            {data.pitch}
          </p>
          {data.reasoning && (
            <p className="mt-6 pt-6 border-t border-line text-sm text-sub leading-relaxed">
              <span className="text-muted">Reasoning:</span> {data.reasoning}
            </p>
          )}
        </div>
      </div>

      {/* Inputs strip */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-muted pt-4 border-t border-line">
        <span>
          <span className="text-sub">URL:</span>{" "}
          <span className="font-mono text-fg/80 break-all">
            {data.inputs.url}
          </span>
        </span>
        <span>
          <span className="text-sub">Repo:</span>{" "}
          <span className="font-mono text-fg/80 break-all">
            {data.inputs.repo || "—"}
          </span>
        </span>
      </div>
    </div>
  );
}

function RubricRow({
  rubricKey,
  score,
  isLast,
}: {
  rubricKey: string;
  score: ScoreCell | undefined;
  isLast: boolean;
}) {
  const meta = RUBRIC_LABELS[rubricKey];
  const L = levelNumber(score?.level);
  const evidence = score?.evidence || "—";

  return (
    <div
      className={
        "grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 px-6 py-5 items-center " +
        (isLast ? "" : "border-b border-line")
      }
    >
      {/* Parameter */}
      <div className="md:col-span-4">
        <div className="text-[15px] font-medium text-fg leading-tight">
          {meta.title}
        </div>
        <div className="mt-1 text-xs text-muted font-mono">
          weight ×{meta.weight}
          <span className="text-line mx-1.5">·</span>
          max {4 * meta.weight} pts
        </div>
      </div>

      {/* Level pills */}
      <div className="md:col-span-3">
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <LevelPill key={n} n={n} selected={n === L} />
          ))}
        </div>
      </div>

      {/* Evidence */}
      <div className="md:col-span-5">
        <p className="text-sm text-sub font-mono leading-relaxed">{evidence}</p>
      </div>
    </div>
  );
}

function LevelPill({ n, selected }: { n: number; selected: boolean }) {
  if (selected) {
    return (
      <div className="h-8 min-w-[40px] px-2.5 rounded-full bg-acid text-black font-semibold text-xs flex items-center justify-center tabular-nums">
        L{n}
      </div>
    );
  }
  return (
    <div className="h-8 min-w-[40px] px-2.5 rounded-full border border-line text-muted font-medium text-xs flex items-center justify-center tabular-nums">
      L{n}
    </div>
  );
}
