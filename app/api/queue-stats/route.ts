/**
 * GET /api/queue-stats — public. Lightweight counts used by the submit page
 * to show a "you're #X in the queue" style indicator. No submission data
 * is leaked (only totals by status).
 */
import { NextResponse } from "next/server";
import { queueStats } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await queueStats();
    return NextResponse.json(stats);
  } catch (e: any) {
    console.error("[/api/queue-stats]", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
