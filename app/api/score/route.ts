/**
 * POST /api/score — the original scoring endpoint used by the home page.
 * Now multi-track aware. If track is omitted or "maas", behavior is
 * identical to before (3-agent pipeline). If track is "virality" or
 * "revenue", dispatches to the single-agent judge for that rubric.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScoringByTrack, ScoreError, TrackId } from "@/lib/score-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

function resolveTrack(raw: unknown): TrackId {
  if (raw === "virality" || raw === "revenue") return raw;
  return "maas";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string | undefined = body?.url;
    const repo: string | undefined = body?.repo || undefined;
    const track: TrackId = resolveTrack(body?.track);
    const stats = body?.stats || undefined;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "`url` is required" }, { status: 400 });
    }

    const traceName =
      track === "virality"
        ? "clawstand-score-virality"
        : track === "revenue"
          ? "clawstand-score-revenue"
          : "clawstand-score";

    const result = await runScoringByTrack(track, url, repo || null, stats, traceName);

    return NextResponse.json({
      track: result.track,
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
