/**
 * POST /api/submissions  — public. Creates a pending submission record and
 *                          returns { id }. Scoring is NOT triggered here;
 *                          the client calls /[id]/run next.
 *
 * GET  /api/submissions   — admin-only (middleware guarded). Returns all
 *                          submissions already ranked.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSubmission, listSubmissions, TrackId } from "@/lib/store";

export const runtime = "nodejs";

function resolveTrack(raw: unknown): TrackId {
  if (raw === "virality" || raw === "revenue") return raw;
  return "maas";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // teamName / userName are now OPTIONAL — the unified landing page can
    // submit anonymously (we default to "Anonymous" / "—"). Admin ranking
    // still works since the fields are always present in the record.
    const teamName = (body?.teamName || "").toString().trim() || "Anonymous";
    const userName = (body?.userName || "").toString().trim() || "—";
    const liveUrl = (body?.liveUrl || "").toString().trim();
    const repoUrl = (body?.repoUrl || "").toString().trim() || null;
    const track = resolveTrack(body?.track);
    const stats = body?.stats && typeof body.stats === "object" ? body.stats : undefined;

    if (!liveUrl) return NextResponse.json({ error: "`liveUrl` is required" }, { status: 400 });

    // Very loose URL sanity check — the agents themselves handle junk URLs.
    try {
      // eslint-disable-next-line no-new
      new URL(liveUrl);
    } catch {
      return NextResponse.json({ error: "`liveUrl` is not a valid URL" }, { status: 400 });
    }
    if (repoUrl) {
      try {
        // eslint-disable-next-line no-new
        new URL(repoUrl);
      } catch {
        return NextResponse.json({ error: "`repoUrl` is not a valid URL" }, { status: 400 });
      }
    }

    const sub = await createSubmission({ teamName, userName, liveUrl, repoUrl, track, stats });
    return NextResponse.json({ id: sub.id, submission: sub }, { status: 201 });
  } catch (e: any) {
    console.error("[/api/submissions POST]", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const list = await listSubmissions();
    return NextResponse.json({ submissions: list });
  } catch (e: any) {
    console.error("[/api/submissions GET]", e);
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
