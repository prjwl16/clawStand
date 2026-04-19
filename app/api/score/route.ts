import { NextRequest, NextResponse } from "next/server";
import { langfuse } from "@/lib/langfuse";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  RUBRIC,
  planExecution,
  productInspector,
  repoAuditor,
  pitchWriter,
} = require("@/lib/agents");

// Run on the Node.js runtime (needed for @anthropic-ai/sdk + Buffer + GitHub REST).
export const runtime = "nodejs";
// LLM calls can be slow; four agents now instead of three.
export const maxDuration = 60;

function levelNumber(level: string | undefined): number {
  if (!level) return 1;
  const n = parseInt(String(level).replace(/[^0-9]/g, ""), 10);
  return n >= 1 && n <= 5 ? n : 1;
}

// Copied verbatim from judge.js:computeTotal to satisfy the "do not refactor" rule.
function computeTotal(scores: Record<string, { level: string }>) {
  let total = 0;
  let maxTotal = 0;
  for (const [key, def] of Object.entries(RUBRIC as Record<string, { weight: number }>)) {
    const L = levelNumber(scores[key] && scores[key].level);
    total += (L - 1) * def.weight;
    maxTotal += 4 * def.weight;
  }
  return { total, maxTotal };
}

// When the planner skips repoAuditor, we still owe the scorer L1 cells for
// the four repo-scored rubric params.
function skippedRepoScores(reason: string) {
  return {
    taskDecompositionQuality: { level: "L1", evidence: reason },
    observability: { level: "L1", evidence: reason },
    evaluationAndIterationTooling: { level: "L1", evidence: reason },
    agentHandoffsAndMemory: { level: "L1", evidence: reason },
  };
}

export async function POST(req: NextRequest) {
  const trace = langfuse.trace({ name: "clawstand-score" });

  try {
    const body = await req.json();
    const url: string | undefined = body?.url;
    const repo: string | undefined = body?.repo || undefined;

    if (!url || typeof url !== "string") {
      trace.update({ output: { error: "url is required" } });
      await langfuse.flushAsync();
      return NextResponse.json({ error: "`url` is required" }, { status: 400 });
    }

    trace.update({ input: { url, repo: repo || null } });

    // --- Parallel: PLANNER + HTML fetch --------------------------------
    // The planner doesn't need the HTML; the fetch is pure I/O.
    const plannerSpan = trace.span({
      name: "planner",
      input: { url, repo: repo || null },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 512 },
    });
    const plannerPromise = planExecution(url, repo || null)
      .then((p: any) => {
        plannerSpan.end({ output: p });
        return p;
      })
      .catch((e: any) => {
        plannerSpan.end({ output: { error: e?.message } });
        throw e;
      });

    const fetchPromise = (async () => {
      const res = await fetch(url, { redirect: "follow" });
      return await res.text();
    })();

    let html: string;
    let plan: any;
    try {
      [plan, html] = await Promise.all([plannerPromise, fetchPromise]);
    } catch (e: any) {
      trace.update({ output: { error: `fetch-or-plan-failed: ${e?.message}` } });
      await langfuse.flushAsync();
      return NextResponse.json(
        { error: `Failed to fetch live URL: ${e?.message || e}` },
        { status: 502 }
      );
    }

    // Enforce the invariant: no repoAuditor without a repo, even if the
    // LLM planner hallucinated one.
    if (!repo) {
      plan.agents = plan.agents.filter((a: any) => a.name !== "repoAuditor");
      plan.skipReasons = plan.skipReasons || [];
      if (!plan.skipReasons.find((s: any) => s.agent === "repoAuditor")) {
        plan.skipReasons.push({
          agent: "repoAuditor",
          reason: "no repo provided",
        });
      }
    }

    const inspectorPlan = plan.agents.find((a: any) => a.name === "productInspector");
    const auditorPlan = plan.agents.find((a: any) => a.name === "repoAuditor");

    // --- Parallel: planned specialists ---------------------------------
    const tasks: Promise<any>[] = [];

    const inspectorSpan = trace.span({
      name: "productInspector",
      input: {
        url,
        htmlLength: html.length,
        focusInstructions: inspectorPlan?.focusInstructions || "",
      },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
    });
    tasks.push(
      productInspector(html, url, inspectorPlan?.focusInstructions).then((r: any) => {
        inspectorSpan.end({ output: r });
        return r;
      })
    );

    let auditorRan = false;
    if (auditorPlan) {
      auditorRan = true;
      const auditorSpan = trace.span({
        name: "repoAuditor",
        input: {
          repo: repo || null,
          focusInstructions: auditorPlan.focusInstructions,
        },
        metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
      });
      tasks.push(
        repoAuditor(repo || null, auditorPlan.focusInstructions).then((r: any) => {
          auditorSpan.end({ output: r });
          return r;
        })
      );
    }

    const results = await Promise.all(tasks);
    const productScores = results[0];
    const repoScores = auditorRan
      ? results[1]
      : skippedRepoScores(
          plan.skipReasons?.find((s: any) => s.agent === "repoAuditor")?.reason
            || "repoAuditor was skipped by the planner"
        );

    const scores = { ...productScores, ...repoScores };
    const { total, maxTotal } = computeTotal(scores);

    // --- Sequential: pitchWriter (unchanged) ---------------------------
    const pitchSpan = trace.span({
      name: "pitchWriter",
      input: { scores, total, maxTotal },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1536 },
    });

    const pitch = await pitchWriter(scores, total, maxTotal);
    pitchSpan.end({ output: pitch });

    const traceUrl = trace.getTraceUrl();

    trace.update({
      output: { total, maxTotal, verdict: pitch.verdict, plan },
    });
    await langfuse.flushAsync();

    return NextResponse.json({
      scores,
      total,
      maxTotal,
      verdict: pitch.verdict,
      pitch: pitch.pitch,
      reasoning: pitch.reasoning,
      inputs: { url, repo: repo || null },
      traceUrl,
      plan,
    });
  } catch (e: any) {
    console.error("[/api/score] error:", e);
    trace.update({ output: { error: e?.message || "Unknown error" } });
    await langfuse.flushAsync();
    return NextResponse.json(
      { error: e?.message || "Unknown error while scoring." },
      { status: 500 }
    );
  }
}
