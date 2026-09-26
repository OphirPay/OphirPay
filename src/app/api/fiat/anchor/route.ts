// SPDX-License-Identifier: MIT

import { successResponse, handleApiError } from "@/lib/api-response";
import { discoverAnchor } from "@/lib/sep24/discovery";

/**
 * GET /api/fiat/anchor — discover and inspect a SEP-24 anchor.
 * Reads the anchor's stellar.toml and /info endpoint.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const domain =
      searchParams.get("domain") ||
      process.env.ANCHOR_DOMAIN ||
      process.env.NEXT_PUBLIC_ANCHOR_DOMAIN ||
      "testnet.kado.sh";

    const allowHttp =
      process.env.NODE_ENV !== "production" &&
      (process.env.ANCHOR_ALLOW_HTTP === "true" || searchParams.get("allowHttp") === "true");

    const config = await discoverAnchor(domain, allowHttp);
    return successResponse(config);
  } catch (err) {
    return handleApiError(err, "GET /api/fiat/anchor");
  }
}
