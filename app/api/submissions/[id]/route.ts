/**
 * GET /api/submissions/[id] — public polling endpoint. Returns the current
 * state of a single submission. Client polls this every 2s while scoring.
 */
import { NextResponse } from "next/server";
import { getSubmission } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sub = await getSubmission(params.id);
    if (!sub) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(sub);
  } catch (e: any) {
    console.error("[/api/submissions/[id] GET]", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
