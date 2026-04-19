"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

const PHASES = [
  "fetching live product HTML",
  "product inspector reading the page",
  "repo auditor querying GitHub",
  "pitch writer composing the verdict",
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

  // Advance the phase label so the user gets feedback across the ~30s wait.
  useEffect(() => {
    if (!loading) return;
    setPhase(0);
    setElapsed(0);
    startRef.current = Date.now();
    const phaseTimers = [
      setTimeout(() => setPhase(1), 2500),
      setTimeout(() => setPhase(2), 9000),
      setTimeout(() => setPhase(3), 20000),
    ];
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => {
      phaseTimers.forEach(clearTimeout);
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

  const runSeconds = useMemo(() => {
    if (!result) return null;
    return elapsed; // final elapsed at the moment loading flipped off
  }, [result, elapsed]);

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar />

      <section className="mx-auto max-w-6xl px-6 sm:px-10 pt-20 pb-10">
        <Hero />
        <div className="mt-16">
          <InputCard
            url={url}
            repo={repo}
            loading={loading}
            onUrl={setUrl}
            onRepo={setRepo}
            onSubmit={submit}
          />
        </div>

        {loading && <PhaseBar phase={phase} elapsed={elapsed} />}

        {error && (
          <div className="mt-10 border border-cut/60 bg-cut/5 p-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cut/80 mb-2">
              error · /api/score
            </div>
            <div className="font-mono text-sm text-cut whitespace-pre-wrap break-words">
              {error}
            </div>
          </div>
        )}

        {result && (
          <div ref={resultsRef} className="mt-24 animate-fade">
            <ResultsLedger result={result} runSeconds={runSeconds} />
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                           */
/* ------------------------------------------------------------------ */

function TopBar() {
  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 sm:px-10 h-10 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-sub">
        <div className="flex items-center gap-4">
          <span className="text-acid">●</span>
          <span>maas rubric</span>
          <span className="text-line">/</span>
          <span>growthx</span>
          <span className="text-line">/</span>
          <span>164 max</span>
        </div>
        <div className="flex items-center gap-4">
          <span>iteration ii</span>
          <span className="text-line">/</span>
          <span>the writ</span>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div className="grid grid-cols-12 gap-8 items-end">
      <div className="col-span-12 lg:col-span-9">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-sub mb-6">
          <span className="text-acid">§</span> a ledger of hackathon claims
        </div>
        <h1 className="font-serif italic leading-[0.88] tracking-tight text-ink">
          <span className="block text-[7.5rem] sm:text-[11rem] lg:text-[14rem]">
            ClawStand
          </span>
        </h1>
        <p className="mt-8 max-w-2xl font-serif italic text-2xl sm:text-3xl leading-tight text-ink/85">
          A live judge for MaaS submissions. Paste a URL.
          <br />
          Read the verdict <span className="text-acid not-italic font-sans font-medium">aloud</span>.
        </p>
      </div>
      <div className="hidden lg:block col-span-3">
        <div className="border border-line p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-sub mb-3">
            weights
          </div>
          <ul className="space-y-1.5 font-mono text-[11px]">
            {RUBRIC_ORDER.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span className="text-ink/80 truncate">{RUBRIC_LABELS[k].title}</span>
                <span className="text-acid">×{RUBRIC_LABELS[k].weight}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function InputCard(props: {
  url: string;
  repo: string;
  loading: boolean;
  onUrl: (v: string) => void;
  onRepo: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { url, repo, loading, onUrl, onRepo, onSubmit } = props;
  return (
    <form onSubmit={onSubmit} className="border-y border-line py-10">
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-7">
          <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-sub mb-2">
            01 · live url <span className="text-cut">*</span>
          </label>
          <Input
            required
            autoFocus
            value={url}
            disabled={loading}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="https://your-submission.vercel.app"
            className="text-2xl sm:text-3xl h-16"
          />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <label className="block font-mono text-[10px] uppercase tracking-[0.28em] text-sub mb-2">
            02 · github repo <span className="text-sub/70">(optional)</span>
          </label>
          <Input
            value={repo}
            disabled={loading}
            onChange={(e) => onRepo(e.target.value)}
            placeholder="https://github.com/team/repo"
            className="text-2xl sm:text-3xl h-16"
          />
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-6">
        <p className="max-w-xl font-serif italic text-sub text-base">
          Three specialist agents run in parallel. The pitch writer delivers
          the verdict last. <span className="text-ink/70">~20–40 seconds.</span>
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={loading || !url.trim()}
          className="min-w-[220px] font-mono uppercase tracking-[0.2em] text-[13px]"
        >
          {loading ? "scoring…" : "score it"}
          {!loading && <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
        </Button>
      </div>
    </form>
  );
}

function PhaseBar({ phase, elapsed }: { phase: number; elapsed: number }) {
  return (
    <div className="mt-10 border border-line p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 font-mono text-sm">
          <span className="text-acid animate-blink">▮</span>
          <span className="text-sub uppercase tracking-[0.22em] text-[11px]">
            phase {phase + 1} / {PHASES.length}
          </span>
          <span className="text-ink">{PHASES[phase]}</span>
        </div>
        <div className="font-mono text-[11px] text-sub uppercase tracking-[0.22em]">
          t+{String(elapsed).padStart(2, "0")}s
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {PHASES.map((_, i) => (
          <div
            key={i}
            className={
              "h-[3px] " +
              (i < phase
                ? "bg-acid"
                : i === phase
                ? "bg-acid/60 animate-pulse"
                : "bg-line")
            }
          />
        ))}
      </div>
    </div>
  );
}

function ResultsLedger({
  result,
  runSeconds,
}: {
  result: ScoreResult;
  runSeconds: number | null;
}) {
  const pct = Math.round((result.total / result.maxTotal) * 100);
  const verdictColor = result.verdict === "NOMINATE" ? "text-nom" : "text-cut";

  return (
    <div className="space-y-24">
      {/* THE LEDGER ---------------------------------------------------- */}
      <section>
        <LedgerHeader kicker="i" title="The Ledger" subtitle="seven parameters, levels L1 through L5" />
        <div className="border-t border-line">
          {RUBRIC_ORDER.map((key, i) => (
            <ParamRow key={key} rubricKey={key} score={result.scores[key]} index={i} />
          ))}
        </div>
      </section>

      {/* THE TOTAL ----------------------------------------------------- */}
      <section>
        <LedgerHeader kicker="ii" title="The Total" subtitle="weighted sum across seven parameters" />
        <div className="grid grid-cols-12 gap-8 mt-6">
          <div className="col-span-12 lg:col-span-7">
            <div className="flex items-end gap-4">
              <span className="font-serif italic text-[9rem] sm:text-[13rem] lg:text-[16rem] leading-[0.82] text-ink">
                {result.total}
              </span>
              <span className="font-serif italic text-4xl sm:text-6xl text-sub pb-4">
                / {result.maxTotal}
              </span>
            </div>
            <div className="mt-6 h-[2px] bg-line relative overflow-hidden">
              <div
                className="h-full bg-acid"
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.22em] text-sub">
              <span>{pct}% of max</span>
              <span>
                nominate bar · <span className="text-ink">82 / 164 (50%)</span>
              </span>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <div className="border border-line p-6 h-full flex flex-col justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-sub mb-3">
                  root parameter
                </div>
                <div className="font-serif text-2xl text-ink italic">
                  Real output shipping
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <BigLevelChip level={result.scores.realOutputShipping?.level || "L1"} />
                  <span className="font-mono text-[11px] text-sub uppercase tracking-[0.22em]">
                    × 20 weight
                  </span>
                </div>
              </div>
              <div className="mt-6 font-serif italic text-ink/80 text-sm leading-snug">
                “If this is L1 or L2, nothing else saves it.”
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* THE VERDICT --------------------------------------------------- */}
      <section>
        <LedgerHeader kicker="iii" title="The Verdict" subtitle="as it would be read aloud on stage" />
        <div className="mt-8">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-sub">
              the ruling
            </span>
            <h2
              className={
                "font-serif italic leading-[0.82] tracking-tight " +
                "text-[8rem] sm:text-[12rem] lg:text-[16rem] " +
                verdictColor
              }
            >
              {result.verdict.toLowerCase()}
            </h2>
          </div>
          <p className="mt-6 max-w-4xl font-serif italic text-xl sm:text-2xl leading-snug text-ink/90">
            {result.reasoning}
          </p>
        </div>
      </section>

      {/* THE PITCH ----------------------------------------------------- */}
      <section>
        <LedgerHeader kicker="iv" title="The Pitch" subtitle="sixty seconds, spoken — first person" />
        <div className="mt-6 border-l-[3px] border-acid pl-8 sm:pl-12 py-6 relative">
          <span
            aria-hidden
            className="absolute -top-8 -left-2 font-serif italic text-[10rem] leading-none text-acid/90 select-none"
          >
            “
          </span>
          <p className="font-serif italic text-2xl sm:text-[2rem] leading-[1.25] text-ink/95 max-w-4xl">
            {result.pitch}
          </p>
          <div className="mt-8 font-mono text-[11px] uppercase tracking-[0.28em] text-sub">
            — the pitch · ~60s · claude sonnet 4.5
          </div>
        </div>
      </section>

      {/* RUN META ------------------------------------------------------ */}
      <section>
        <LedgerHeader kicker="v" title="The Receipt" subtitle="inputs and run metadata" />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-line">
          <MetaRow label="live url" value={result.inputs.url} />
          <MetaRow label="github repo" value={result.inputs.repo || "— not provided —"} />
          <MetaRow
            label="wall time"
            value={runSeconds != null ? `${runSeconds}s` : "—"}
          />
          <MetaRow label="model" value="claude-sonnet-4-5-20250929" />
          <MetaRow label="agents" value="inspector · auditor · pitch writer" />
          <MetaRow
            label="nominate rule"
            value={
              result.verdict === "NOMINATE"
                ? "passed · ≥82 total · root ≥ L3"
                : "failed heuristic"
            }
          />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Atoms                                                               */
/* ------------------------------------------------------------------ */

function LedgerHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-line pb-4">
      <div className="flex items-baseline gap-6">
        <span className="font-serif italic text-sub text-xl">{kicker}.</span>
        <h2 className="font-serif italic text-4xl sm:text-5xl text-ink tracking-tight">
          {title}
        </h2>
      </div>
      <div className="hidden sm:block font-mono text-[10px] uppercase tracking-[0.28em] text-sub text-right">
        {subtitle}
      </div>
    </div>
  );
}

function ParamRow({
  rubricKey,
  score,
  index,
}: {
  rubricKey: string;
  score: ScoreCell | undefined;
  index: number;
}) {
  const meta = RUBRIC_LABELS[rubricKey];
  const L = levelNumber(score?.level);
  const evidence = score?.evidence || "—";

  return (
    <div
      className={
        "grid grid-cols-12 gap-6 items-start py-7 border-b border-line " +
        (meta.root ? "bg-acid/[0.02]" : "")
      }
    >
      {/* index + weight */}
      <div className="col-span-12 md:col-span-1 flex md:flex-col items-center md:items-start gap-3 md:gap-1 font-mono text-[11px] uppercase tracking-[0.22em] text-sub">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <span className="text-acid">×{meta.weight}</span>
      </div>

      {/* param title + sub */}
      <div className="col-span-12 md:col-span-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif italic text-2xl text-ink leading-tight">
            {meta.title}
          </span>
          {meta.root && <Badge variant="acid">root</Badge>}
        </div>
        <div className="mt-1 font-mono text-[11px] text-sub">{meta.sub}</div>
      </div>

      {/* level row */}
      <div className="col-span-12 md:col-span-3">
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <LevelCell key={n} n={n} selected={n === L} />
          ))}
        </div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-sub">
          points · <span className="text-ink">{(L - 1) * meta.weight}</span> /{" "}
          {4 * meta.weight}
        </div>
      </div>

      {/* evidence */}
      <div className="col-span-12 md:col-span-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-sub mb-1">
          evidence
        </div>
        <p className="font-serif italic text-ink/90 text-[1.05rem] leading-snug">
          {evidence}
        </p>
      </div>
    </div>
  );
}

function LevelCell({ n, selected }: { n: number; selected: boolean }) {
  if (selected) {
    return (
      <div className="h-9 min-w-[2.6rem] px-2 bg-acid text-black font-mono text-[12px] font-bold tracking-wider flex items-center justify-center">
        L{n}
      </div>
    );
  }
  return (
    <div className="h-9 min-w-[2.6rem] px-2 border border-line text-sub font-mono text-[12px] tracking-wider flex items-center justify-center">
      L{n}
    </div>
  );
}

function BigLevelChip({ level }: { level: string }) {
  const L = levelNumber(level);
  return (
    <div className="h-11 px-4 bg-acid text-black font-mono text-sm font-bold tracking-wider flex items-center">
      L{L}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-6 px-0 py-3 border-b border-line">
      <div className="w-40 font-mono text-[10px] uppercase tracking-[0.28em] text-sub shrink-0">
        {label}
      </div>
      <div className="font-mono text-[13px] text-ink break-all">{value}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 mt-32 border-t border-line">
      <div className="mx-auto max-w-6xl px-6 sm:px-10 h-20 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.28em] text-sub">
        <div className="flex items-center gap-4">
          <span className="text-acid">●</span>
          <span>clawstand</span>
          <span className="text-line">/</span>
          <span>built for the stage</span>
        </div>
        <div>read the verdict aloud.</div>
      </div>
    </footer>
  );
}
