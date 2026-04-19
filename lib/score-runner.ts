/**
 * Score pipeline extracted from app/api/score/route.ts so both the original
 * route AND the new /api/submissions/[id]/run route call the same code path.
 * Behavior-preserving: same planner, same parallel productInspector +
 * repoAuditor, same pitchWriter, same Langfuse tracing, same JSON shape.
 */
import { langfuse } from "@/lib/langfuse";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  RUBRIC,
  planExecution,
  productInspector,
  repoAuditor,
  pitchWriter,
} = require("@/lib/agents");

export type ScoreCell = { level: string; evidence: string };

export type ScoreResult = {
  scores: Record<string, ScoreCell>;
  total: number;
  maxTotal: number;
  verdict: "NOMINATE" | "CUT";
  pitch: string;
  reasoning: string;
  inputs: { url: string; repo: string | null };
  traceUrl: string | null;
  plan: any;
};

export class ScoreError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

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

function looksLikeValidGithubUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  return /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(u);
}

/**
 * Run the full 3-agent scoring pipeline on a URL (and optional repo).
 * Returns the full result with trace URL. Throws ScoreError on fatal
 * failures (bad input, fetch failed). Langfuse flush is handled here.
 */
export async function runScoring(
  url: string,
  repo: string | null,
  traceName: string = "clawstand-score"
): Promise<ScoreResult> {
  if (!url || typeof url !== "string") {
    throw new ScoreError("`url` is required", 400);
  }

  const trace = langfuse.trace({ name: traceName });

  try {
    trace.update({ input: { url, repo: repo || null } });

    // ---- 1. PLANNER ----
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

    // Enforce invariants on the plan (same as original route)
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

    // ---- 2. Fetch HTML ----
    let html = "";
    try {
      const res = await fetch(url, { redirect: "follow" });
      html = await res.text();
    } catch (e: any) {
      throw new ScoreError(`Failed to fetch live URL: ${e?.message || e}`, 502);
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

    // ---- 4. Pitch Writer ----
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

    return {
      scores,
      total,
      maxTotal,
      verdict: pitch.verdict,
      pitch: pitch.pitch,
      reasoning: pitch.reasoning,
      inputs: { url, repo: repo || null },
      traceUrl,
      plan,
    };
  } catch (e: any) {
    trace.update({ output: { error: e?.message || "Unknown error" } });
    await langfuse.flushAsync();
    if (e instanceof ScoreError) throw e;
    throw new ScoreError(e?.message || "Unknown error while scoring.", 500);
  }
}
