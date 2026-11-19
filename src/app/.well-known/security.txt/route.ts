// SPDX-License-Identifier: MIT

import { generateSecurityTxt } from "@/lib/security-txt";

export const dynamic = "force-static";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function GET(): Response {
  return new Response(generateSecurityTxt(), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export function HEAD(): Response {
  return new Response(null, { headers: GET().headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
