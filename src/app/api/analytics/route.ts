// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import { z } from "zod";
import {
  successResponse,
  unauthorizedError,
  badRequestError,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { withRequestLogging } from "@/lib/request-logging";
import { cachedRead, readCacheKey, READ_TTL_MS } from "@/lib/api-cache";
import { readCacheHeaders } from "@/lib/cache";
import { getAnalyticsMetrics } from "@/lib/db/analytics";
import { isTimeoutError } from "@/lib/timeout";
import { problemGatewayTimeout } from "@/lib/api-errors";

const ISO_OR_DATE_STRING = z.string().refine((val) => !isNaN(Date.parse(val)), {
  message: "Invalid date format. Expected valid ISO-8601 or YYYY-MM-DD date string.",
});

const analyticsQuerySchema = z.object({
  from: ISO_OR_DATE_STRING.optional(),
  to: ISO_OR_DATE_STRING.optional(),
  startDate: ISO_OR_DATE_STRING.optional(),
  endDate: ISO_OR_DATE_STRING.optional(),
  days: z.coerce.number().int().min(1, "days must be at least 1").max(365, "days cannot exceed 365").optional(),
});

/**
 * GET /api/analytics — Aggregated payment metrics scoped to the
 * authenticated user. Supports safe parameterized date range filtering (#1396).
 */
export const GET = withMetrics("GET /api/analytics", withRequestLogging(async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        "Authentication required. Connect your wallet or provide an API key."
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = analyticsQuerySchema.safeParse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      days: searchParams.get("days") ?? undefined,
    });

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { days } = parsed.data;
    const rawFrom = parsed.data.from || parsed.data.startDate;
    const rawTo = parsed.data.to || parsed.data.endDate;

    let fromDate: Date;
    const toDate: Date = rawTo ? new Date(rawTo) : new Date();

    if (days) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
    } else if (rawFrom) {
      fromDate = new Date(rawFrom);
    } else {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
    }

    if (fromDate > toDate) {
      return badRequestError("'from' date cannot be after 'to' date");
    }

    const scope = { userId: auth.userId };
    const dateRangeCachePart = `${fromDate.toISOString().slice(0, 10)}_${toDate.toISOString().slice(0, 10)}`;

    const { value: payload, status } = await cachedRead(
      readCacheKey("analytics", `${auth.userId}:${dateRangeCachePart}`),
      async () => getAnalyticsMetrics(scope, fromDate, toDate),
      READ_TTL_MS.analytics
    );

    return successResponse(payload, undefined, 200, readCacheHeaders(status));
  } catch (err) {
    if (isTimeoutError(err) || (err instanceof Error && /timeout/i.test(err.message))) {
      return problemGatewayTimeout(
        "Analytics aggregation query timed out after 5 seconds. Please narrow your date range and try again.",
        { instance: "/api/analytics" }
      );
    }
    return handleApiError(err, "GET /api/analytics");
  }
}));
