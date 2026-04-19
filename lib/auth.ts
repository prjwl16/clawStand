/**
 * HTTP Basic Auth — hardcoded credentials. Minimum viable gate for mentor
 * routes. NO session, NO DB. Browser prompts natively via 401 +
 * WWW-Authenticate, then sends Authorization on every subsequent request.
 *
 * Edge runtime compatible (uses atob/btoa, not Buffer).
 */

export const ADMIN_USER = "buildathon";
export const ADMIN_PASS = "password";

const EXPECTED = "Basic " + encodeB64(`${ADMIN_USER}:${ADMIN_PASS}`);

function encodeB64(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  // Fallback for Node runtime (Buffer is available there)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return Buffer.from(s, "utf-8").toString("base64");
}

export function isAuthorized(authHeader: string | null | undefined): boolean {
  if (!authHeader) return false;
  // Constant-ish time compare; not strictly necessary for a hardcoded demo cred.
  return authHeader === EXPECTED;
}

export function unauthorizedResponse(): Response {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ClawStand Admin", charset="UTF-8"',
    },
  });
}
