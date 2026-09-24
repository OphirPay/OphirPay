// SPDX-License-Identifier: MIT

import { withRequestLogging } from "@/lib/request-logging";
import { successResponse, unauthorizedError, handleApiError } from "@/lib/api-response";
import { authorizeCronRequest } from "@/lib/scheduler";
import { transitionOverduePaymentRequests } from "@/lib/payment-requests";
import { verifyCsrf } from "@/lib/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleExpiryTransition(request: Request) {
  try {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
    if (!auth.ok && process.env.CRON_SECRET) {
      return unauthorizedError("Invalid or missing cron secret.");
    }

    const result = await transitionOverduePaymentRequests(new Date());
    return successResponse(result);
  } catch (err) {
    return handleApiError(err, "POST /api/cron/requests-expiry");
  }
}

export const GET = withRequestLogging(async function GET(request: Request) {
  return handleExpiryTransition(request);
});

export const POST = withRequestLogging(async function POST(request: Request) {
  return handleExpiryTransition(request);
});
