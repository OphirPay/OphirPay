// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { z } from "zod";
import {
  successResponse,
  handleApiError,
  validationError,
  badRequestError,
} from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { isValidAssetIssuer } from "@/lib/assets";
import { resolveAssetMetadata } from "@/lib/asset-metadata";
import { sanitizeImageUrl } from "@/lib/sanitize-url";

/**
 * GET /api/assets/metadata?code=<CODE>&issuer=<G...>
 *
 * Resolves display metadata for a custom Stellar asset from the issuer's
 * SEP-1 `stellar.toml` (issue #824). The fetch runs server-side so the
 * outbound request goes through the shared DNS/URL guard and timeout budget,
 * and the parsed TOML is cached per issuer domain.
 *
 * Never fails on missing metadata: an unknown or unreachable issuer returns a
 * `fallback` result with `name: null` so the UI renders `code + issuer`
 * without an error surface.
 */
export const GET = withMetrics(
  "GET /api/assets/metadata",
  withRequestLogging(async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const parsed = z
        .object({
          code: z.string().trim().min(1).max(12),
          issuer: z.string().trim().min(1),
        })
        .safeParse({
          code: url.searchParams.get("code") ?? "",
          issuer: url.searchParams.get("issuer") ?? "",
        });

      if (!parsed.success) return validationError(parsed.error);
      const { code, issuer } = parsed.data;

      if (!isValidAssetIssuer(issuer)) {
        return badRequestError(
          "issuer must be a valid Stellar account address (G…, 56 characters)."
        );
      }

      const metadata = await resolveAssetMetadata({ code, issuer });
      // Defense in depth (issue #1391): resolveAssetMetadata already sanitizes
      // the issuer-supplied logo, but this route is the trust boundary that
      // ships data to the browser, so re-assert it here. A URL that fails the
      // guard is returned as `null` and the UI falls back to the text badge.
      return successResponse({ ...metadata, image: sanitizeImageUrl(metadata.image) });
    } catch (err) {
      return handleApiError(err, "GET /api/assets/metadata");
    }
  })
);
