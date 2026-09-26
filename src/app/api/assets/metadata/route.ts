// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { successResponse, badRequest, handleApiError } from "@/lib/api-response";
import { resolveAssetMetadata } from "@/lib/assets";

/**
 * GET /api/assets/metadata?code=...&issuer=...&domain=...
 * Resolves SEP-1 asset metadata for custom Stellar assets.
 */
export const GET = withMetrics(
  "GET /api/assets/metadata",
  withRequestLogging(async function GET(request: Request) {
    try {
      const { searchParams } = new URL(request.url);
      const code = searchParams.get("code");
      const issuer = searchParams.get("issuer") || undefined;
      const domain = searchParams.get("domain") || undefined;

      if (!code) {
        return badRequest("Asset code is required");
      }

      const metadata = await resolveAssetMetadata(code, issuer, { domain });
      return successResponse(metadata);
    } catch (err) {
      return handleApiError(err, "GET /api/assets/metadata");
    }
  })
);
