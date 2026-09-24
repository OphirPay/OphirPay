// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import {
  successResponse,
  handleApiError,
  badRequestError,
  unauthorizedError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { enforceLookupRateLimit } from "@/lib/lookup-rate-limit";
import { isValidAssetIssuer } from "@/lib/assets";
import { resolveAssetMetadata } from "@/lib/asset-metadata";

/**
 * GET /api/asset-metadata?code=EURT&issuer=G...&network=PUBLIC
 *
 * Resolves a custom asset's human-readable display name from the issuer's
 * SEP-1 stellar.toml. Results are cached per issuer domain server-side.
 *
 * Returns `{ metadata: null }` when the asset can't be resolved; callers
 * degrade to showing the raw code + issuer. This endpoint never surfaces a
 * hard error for an unresolvable asset.
 */
export const GET = withMetrics(
  "GET /api/asset-metadata",
  withRequestLogging(async function GET(request: Request) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key.",
        );
      }

      const rateLimited = await enforceLookupRateLimit(request);
      if (rateLimited) return rateLimited;

      const { searchParams } = new URL(request.url);
      const code = searchParams.get("code")?.trim();
      const issuer = searchParams.get("issuer")?.trim();
      const networkParam = (searchParams.get("network") ?? "PUBLIC").trim();

      if (!code) {
        return badRequestError("Missing required query parameter: code.");
      }
      if (!issuer || !isValidAssetIssuer(issuer)) {
        return badRequestError(
          "Missing or invalid query parameter: issuer (must be a G... Stellar account id).",
        );
      }
      if (networkParam !== "PUBLIC" && networkParam !== "TESTNET") {
        return badRequestError("network must be PUBLIC or TESTNET.");
      }

      const metadata = await resolveAssetMetadata(
        code,
        issuer,
        networkParam,
      );

      return successResponse({ metadata });
    } catch (err) {
      return handleApiError(err, "GET /api/asset-metadata");
    }
  }),
);
