/**
 * POST /api/submissions/[id]/notes — admin only (guarded by middleware.ts).
 * Appends a mentor note. Notes are metadata; they do NOT affect scores or
 * ranking.
 */
import { NextRequest, NextResponse } from "next/server";
import { addNote, getSubmission } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const mentor = (body?.mentor || "mentor").toString();
    const text = (body?.text || "").toString().trim();
    if (!text) return NextResponse.json({ error: "`text` is required" }, { status: 400 });
    if (text.length > 4000)
      return NextResponse.json({ error: "note too long" }, { status: 400 });

    const existing = await getSubmission(params.id);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updated = await addNote(params.id, mentor, text);
    return NextResponse.json({ submission: updated });
  } catch (e: any) {
    console.error("[/api/submissions/[id]/notes POST]", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
