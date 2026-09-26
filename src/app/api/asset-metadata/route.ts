// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { successResponse, badRequestError, unauthorizedError, handleApiError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";
import { isValidAssetIssuer } from "@/lib/assets";
import { resolveAssetMetadata } from "@/lib/asset-metadata";

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/** Resolved metadata is public, slow-moving data — let clients cache it. */
const CACHE_HEADER = "public, max-age=300, stale-while-revalidate=600";

/**
 * GET /api/asset-metadata?code=...&issuer=... — SEP-1 display metadata for a
 * custom asset, resolved from the issuer's home-domain stellar.toml.
 *
 * Always returns 200 with a degradation-safe payload for valid input: when no
 * metadata exists (unknown issuer, unreachable domain, malformed TOML,
 * timeout) the response is `{ resolved: false, name: null }` and the UI
 * falls back to the raw code plus issuer — no error surface.
 */
export const GET = withMetrics("GET /api/asset-metadata", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code") ?? "";
    const issuer = searchParams.get("issuer") ?? "";

    if (!ASSET_CODE_RE.test(code)) {
      return badRequestError("Invalid asset code");
    }
    if (!isValidAssetIssuer(issuer)) {
      return badRequestError("Invalid asset issuer");
    }

    // Rate-limit issuer-keyed lookups: each cache miss can trigger outbound
    // Horizon + TOML fetches, so unauthenticated-style hammering must not
    // turn the server into a fetch amplifier.
    const rateLimited = await enforceLookupRateLimit(request, { address: issuer });
    if (rateLimited) return rateLimited;

    const metadata = await resolveAssetMetadata(code, issuer);
    return successResponse(metadata, undefined, 200, CACHE_HEADER);
  } catch (err) {
    return handleApiError(err, "GET /api/asset-metadata");
  }
}));
