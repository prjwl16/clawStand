/**
 * POST /api/submissions/[id]/run — kicks off the 3-agent scoring pipeline
 * for a pending submission. The client fires this without awaiting the
 * response and polls the GET endpoint for status changes. Takes ~30-40s.
 *
 * Must run on Node runtime (Anthropic SDK + fs for local dev store).
 */
import { NextResponse } from "next/server";
import { getSubmission, saveScored, saveFailed } from "@/lib/store";
import { runScoring, ScoreError } from "@/lib/score-runner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;

  const sub = await getSubmission(id);
  if (!sub) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Idempotency: don't re-run a submission that's already scored or actively
  // scoring. The status model here is binary (pending / scored / failed) so
  // concurrent /run calls will both proceed — the last writer wins. Acceptable
  // for a hackathon demo; re-triggering a score is a feature anyway.
  if (sub.status === "scored") {
    return NextResponse.json({ ok: true, submission: sub, skipped: "already scored" });
  }

  try {
    const result = await runScoring(sub.liveUrl, sub.repoUrl, `submission:${id}`);
    const updated = await saveScored(id, {
      scores: result.scores,
      total: result.total,
      maxTotal: result.maxTotal,
      verdict: result.verdict,
      pitch: result.pitch,
      reasoning: result.reasoning,
      traceUrl: result.traceUrl || undefined,
      plan: result.plan,
    });
    return NextResponse.json({ ok: true, submission: updated });
  } catch (e: any) {
    const msg =
      e instanceof ScoreError
        ? e.message
        : e?.message || "Unknown scoring error";
    console.error(`[/api/submissions/${id}/run]`, msg);
    const updated = await saveFailed(id, msg);
    const status = e instanceof ScoreError ? e.status : 500;
    return NextResponse.json({ ok: false, error: msg, submission: updated }, { status });
  }
}
