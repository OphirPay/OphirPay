// SPDX-License-Identifier: MIT

import { generateCsrfToken, csrfCookieHeader } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/csrf — mint a CSRF token for this session.
 *
 * Sets the HttpOnly `__Host-csrf` cookie AND returns the token in the body
 * so client-side code can echo it back via the `x-csrf-token` header on
 * mutation requests (double-submit cookie pattern, see lib/csrf.ts).
 */
export const GET = withRequestLogging(async function GET(request: Request) {
  const token = generateCsrfToken();

  // The __Host-/Secure flags are only valid over HTTPS; over plain http (dev
  // on a LAN IP) the cookie must be set without them or browsers reject it.
  const url = new URL(request.url);
  const secure = url.protocol === "https:" || process.env.NODE_ENV === "production";

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": csrfCookieHeader(token, secure),
    },
  });
});
