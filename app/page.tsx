"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
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
  traceUrl?: string;
};

/**
 * Honest ClawStand self-score. Shown before any real run.
 * total = (3-1)*20 + (4-1)*5 + (2-1)*7 + (1-1)*5 + (2-1)*2 + (3-1)*1 + (3-1)*1 = 68
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

      <div className="mx-auto max-w-5xl px-6 sm:px-10 pt-14 pb-20">
        {/* Tagline -------------------------------------------------- */}
        <section>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[0.98] text-fg">
            An AI judge
            <br />
            for hackathon submissions.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-sub max-w-xl leading-relaxed">
            Scores against the GrowthX MaaS rubric. Writes the pitch-down
            verdict.
          </p>
        </section>

        {/* Input form ---------------------------------------------- */}
        <form onSubmit={submit} className="mt-10 space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-fg">
              Live URL <span className="text-acid">*</span>
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

          <div className="pt-1">
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

        {/* Error state --------------------------------------------- */}
        {error && (
          <div className="mt-8 rounded-md border border-line bg-surface p-5">
            <div className="text-xs uppercase tracking-wider font-medium text-acid mb-2">
              Error
            </div>
            <div className="font-mono text-sm text-fg/90 whitespace-pre-wrap break-words">
              {error}
            </div>
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
      <div className="mx-auto max-w-5xl px-6 sm:px-10 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-acid" />
          <span className="text-sm font-semibold tracking-tight text-fg">
            ClawStand
          </span>
        </div>
        <nav className="flex items-center gap-5">
          <Link
            href="/submit"
            className="text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-acid"
          >
            Submit
          </Link>
          <Link
            href="/admin"
            className="text-xs font-mono uppercase tracking-[0.18em] text-muted hover:text-acid"
          >
            Admin
          </Link>
          <span className="hidden sm:inline text-line">·</span>
          <span className="hidden sm:inline text-xs text-sub">
            MaaS rubric <span className="text-line">·</span> 164 max
          </span>
        </nav>
      </div>
    </header>
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

function ResultView({ data }: { data: ScoreResult }) {
  const isNom = data.verdict === "NOMINATE";

  return (
    <div className="space-y-10">
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
          Total score
        </div>
      </div>

      {/* Rubric table --------------------------------------------- */}
      <div className="border-t border-line">
        {RUBRIC_ORDER.map((key) => (
          <RubricRow
            key={key}
            rubricKey={key}
            score={data.scores[key]}
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
  score: ScoreCell | undefined;
}) {
  const meta = RUBRIC_LABELS[rubricKey];
  const L = levelNumber(score?.level);
  const evidence = score?.evidence || "—";

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-6 py-4 border-b border-line">
      {/* Parameter + weight */}
      <div className="md:col-span-4 flex items-start gap-3">
        <span className="text-xs font-mono text-muted tabular-nums pt-[3px] w-8 shrink-0">
          ×{meta.weight}
        </span>
        <span className="text-[15px] font-medium text-fg leading-snug">
          {meta.title}
        </span>
      </div>

      {/* Level pills */}
      <div className="md:col-span-3">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <LevelPill key={n} n={n} selected={n === L} />
          ))}
        </div>
      </div>

      {/* Evidence */}
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
  if (selected) {
    return (
      <div className={base + " bg-acid text-black font-semibold"}>L{n}</div>
    );
  }
  return (
    <div className={base + " border border-line text-muted"}>L{n}</div>
  );
}
