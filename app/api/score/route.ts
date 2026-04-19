/**
 * POST /api/score — the original scoring endpoint used by the home page.
 * Unchanged external contract. Internals now delegate to lib/score-runner
 * so the submissions pipeline can share the exact same code.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScoring, ScoreError } from "@/lib/score-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string | undefined = body?.url;
    const repo: string | undefined = body?.repo || undefined;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "`url` is required" }, { status: 400 });
    }

    const result = await runScoring(url, repo || null, "clawstand-score");

    // Preserve original shape — the home page UI depends on these exact keys.
    return NextResponse.json({
      scores: result.scores,
      total: result.total,
      maxTotal: result.maxTotal,
      verdict: result.verdict,
      pitch: result.pitch,
      reasoning: result.reasoning,
      inputs: result.inputs,
      traceUrl: result.traceUrl,
      plan: result.plan,
    });
  } catch (e: any) {
    const status = e instanceof ScoreError ? e.status : 500;
    const msg =
      e instanceof ScoreError
        ? e.message
        : e?.message || "Unknown error while scoring.";
    console.error("[/api/score] error:", msg);
    return NextResponse.json({ error: msg }, { status });
  }
}
