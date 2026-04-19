/**
 * Guards admin pages (/admin/**) and admin APIs behind HTTP Basic Auth.
 *
 * Admin routes:
 *   - /admin and /admin/*                         (pages)
 *   - GET /api/submissions                        (list all — leak if public)
 *   - POST /api/submissions/[id]/notes            (write)
 *
 * Public routes (explicitly NOT guarded):
 *   - POST /api/submissions                       (team creates submission)
 *   - GET  /api/submissions/[id]                  (polling a single submission)
 *   - POST /api/submissions/[id]/run              (triggers scoring pipeline)
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";

function requiresAdmin(pathname: string, method: string): boolean {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if (pathname === "/api/submissions" && method === "GET") return true;
  if (/^\/api\/submissions\/[^/]+\/notes$/.test(pathname)) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!requiresAdmin(pathname, req.method)) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (isAuthorized(auth)) {
    return NextResponse.next();
  }

  // For API routes, return a plain 401 JSON. For pages, a 401 with
  // WWW-Authenticate triggers the browser credential prompt.
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Basic realm="ClawStand Admin"',
      },
    });
  }
  return unauthorizedResponse() as unknown as NextResponse;
}

// Run middleware on these paths only (all others skip it entirely — perf win).
export const config = {
  matcher: [
    "/admin/:path*",
    "/admin",
    "/api/submissions",
    "/api/submissions/:id/notes",
  ],
};
