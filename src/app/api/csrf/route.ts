// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { NextResponse } from "next/server";
import { generateCsrfToken, csrfCookieHeader } from "@/lib/csrf";
import { withRequestLogging } from "@/lib/request-logging";

/**
 * GET /api/csrf
 * 
 * Mints a new CSRF token and sets it as an HttpOnly cookie.
 * The token is also returned in the response body for the client
 * to store in memory and send as the x-csrf-token header on
 * mutating requests.
 * 
 * Security:
 * - Token is cryptographically random (256 bits)
 * - Cookie is HttpOnly, Secure (prod), SameSite=Strict
 * - Cookie uses __Host- prefix in production (host-only)
 * - Token rotates on each mint (invalidates previous token)
 */
export const GET = withMetrics("GET /api/csrf", withRequestLogging(async function GET(request: Request) {
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
}));
