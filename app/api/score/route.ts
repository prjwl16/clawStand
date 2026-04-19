import { NextRequest, NextResponse } from "next/server";
import { langfuse } from "@/lib/langfuse";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RUBRIC, productInspector, repoAuditor, pitchWriter } = require("@/lib/agents");

// Run on the Node.js runtime (needed for @anthropic-ai/sdk + Buffer + GitHub REST).
export const runtime = "nodejs";
// LLM calls can be slow; give the function room to breathe.
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

export async function POST(req: NextRequest) {
  const trace = langfuse.trace({
    name: "clawstand-score",
  });

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

    // --- Parallel: productInspector + repoAuditor, each wrapped in a span ---
    const inspectorSpan = trace.span({
      name: "productInspector",
      input: { url, htmlLength: html.length },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
    });

    const auditorSpan = trace.span({
      name: "repoAuditor",
      input: { repo: repo || null },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1024 },
    });

    const [productScores, repoScores] = await Promise.all([
      productInspector(html, url).then((res: any) => {
        inspectorSpan.end({ output: res });
        return res;
      }),
      repoAuditor(repo || null).then((res: any) => {
        auditorSpan.end({ output: res });
        return res;
      }),
    ]);

    const scores = { ...productScores, ...repoScores };
    const { total, maxTotal } = computeTotal(scores);

    // --- Sequential: pitchWriter ---
    const pitchSpan = trace.span({
      name: "pitchWriter",
      input: { scores, total, maxTotal },
      metadata: { model: "claude-sonnet-4-5-20250929", maxTokens: 1536 },
    });

    const pitch = await pitchWriter(scores, total, maxTotal);
    pitchSpan.end({ output: pitch });

    const traceUrl = trace.getTraceUrl();

    trace.update({
      output: { total, maxTotal, verdict: pitch.verdict },
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
