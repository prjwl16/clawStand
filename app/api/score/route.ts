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

export const runtime = "nodejs";
export const maxDuration = 60;

function levelNumber(level: string | undefined): number {
  if (!level) return 1;
  const n = parseInt(String(level).replace(/[^0-9]/g, ""), 10);
  return n >= 1 && n <= 5 ? n : 1;
}

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

// L1 fallbacks when the planner says run=false, per-agent.
function skippedScoresFor(agentName: string, reason: string) {
  if (agentName === "productInspector") {
    return {
      realOutputShipping: { level: "L1", evidence: `skipped: ${reason}` },
      managementUIUsability: { level: "L1", evidence: `skipped: ${reason}` },
      costAndLatencyOnJudgeTask: { level: "L1", evidence: `skipped: ${reason}` },
    };
  }
  if (agentName === "repoAuditor") {
    return {
      taskDecompositionQuality: { level: "L1", evidence: `skipped: ${reason}` },
      observability: { level: "L1", evidence: `skipped: ${reason}` },
      evaluationAndIterationTooling: { level: "L1", evidence: `skipped: ${reason}` },
      agentHandoffsAndMemory: { level: "L1", evidence: `skipped: ${reason}` },
    };
  }
  return {};
}

// Defensive check: an https://github.com/<owner>/<name> shape.
function looksLikeValidGithubUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  return /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(u);
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

    // ---- 1. PLANNER (span runs first, as a child of clawstand-score) ----
    const plannerSpan = trace.span({
      name: "planner",
      input: { url, repo: repo || null },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 512 },
    });
    let plan: any;
    try {
      plan = await planExecution(url, repo || null);
      plannerSpan.end({ output: plan });
    } catch (e: any) {
      plannerSpan.end({ output: { error: e?.message } });
      throw e;
    }

    // Enforce invariants on the plan (defensive — never trust an LLM output blindly):
    //   1. productInspector.run must be true
    //   2. repoAuditor must be present; run is false iff no repo or invalid github URL
    plan.agents = (plan.agents || []).filter(
      (a: any) => a && (a.name === "productInspector" || a.name === "repoAuditor")
    );
    if (!plan.agents.find((a: any) => a.name === "productInspector")) {
      plan.agents.unshift({
        name: "productInspector",
        run: true,
        focusInstructions: "",
      });
    }
    if (!plan.agents.find((a: any) => a.name === "repoAuditor")) {
      plan.agents.push({
        name: "repoAuditor",
        run: !!(repo && looksLikeValidGithubUrl(repo)),
        focusInstructions: "",
        skipReason: !repo ? "no repo provided" : undefined,
      });
    }
    plan.agents = plan.agents.map((a: any) => {
      if (a.name === "productInspector") return { ...a, run: true };
      if (a.name === "repoAuditor") {
        if (!repo || !looksLikeValidGithubUrl(repo)) {
          return {
            ...a,
            run: false,
            skipReason:
              a.skipReason ||
              (!repo ? "no repo provided" : "repo URL doesn't match github.com/owner/name"),
          };
        }
      }
      return a;
    });

    // ---- 2. Fetch HTML (product inspector needs it) ----
    let html = "";
    try {
      const res = await fetch(url, { redirect: "follow" });
      html = await res.text();
    } catch (e: any) {
      trace.update({ output: { error: `Failed to fetch: ${e?.message}` } });
      await langfuse.flushAsync();
      return NextResponse.json(
        { error: `Failed to fetch live URL: ${e?.message || e}` },
        { status: 502 }
      );
    }

    // ---- 3. Run planned specialists in parallel ----
    const tasks: Promise<any>[] = [];
    let productScores: any = null;
    let repoScores: any = null;

    for (const agent of plan.agents) {
      if (agent.name === "productInspector") {
        if (agent.run) {
          const span = trace.span({
            name: "productInspector",
            input: { url, htmlLength: html.length, focusInstructions: agent.focusInstructions || "" },
            metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
          });
          tasks.push(
            productInspector(html, url, agent.focusInstructions).then((r: any) => {
              span.end({ output: r });
              productScores = r;
            })
          );
        } else {
          productScores = skippedScoresFor("productInspector", agent.skipReason || "skipped by planner");
        }
      }

      if (agent.name === "repoAuditor") {
        if (agent.run) {
          const span = trace.span({
            name: "repoAuditor",
            input: { repo: repo || null, focusInstructions: agent.focusInstructions || "" },
            metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
          });
          tasks.push(
            repoAuditor(repo || null, agent.focusInstructions).then((r: any) => {
              span.end({ output: r });
              repoScores = r;
            })
          );
        } else {
          repoScores = skippedScoresFor("repoAuditor", agent.skipReason || "skipped by planner");
        }
      }
    }

    await Promise.all(tasks);

    const scores = { ...productScores, ...repoScores };
    const { total, maxTotal } = computeTotal(scores);

    // ---- 4. Pitch Writer (UNCHANGED signature; plan.reasoning only surfaces in trace/response) ----
    const pitchSpan = trace.span({
      name: "pitchWriter",
      input: { scores, total, maxTotal },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1536 },
    });
    const pitch = await pitchWriter(scores, total, maxTotal);
    pitchSpan.end({ output: pitch });

    const traceUrl = trace.getTraceUrl();

    trace.update({
      output: { total, maxTotal, verdict: pitch.verdict, planReasoning: plan.reasoning },
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
