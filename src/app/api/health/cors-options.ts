// SPDX-License-Identifier: MIT

import { getCorsHeaders } from "@/lib/headers";

/**
 * Shared OPTIONS handler for API routes that need CORS preflight support.
 */
export function OPTIONS() {
  const headers = getCorsHeaders();
  return new Response(null, {
    status: 204,
    headers,
  });
}
