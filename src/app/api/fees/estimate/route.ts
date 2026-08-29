// SPDX-License-Identifier: MIT

import { withMetrics } from "@/lib/metrics-middleware";
import { successResponse, handleApiError, validationError } from "@/lib/api-response";
import { withRequestLogging } from "@/lib/request-logging";
import { estimateTotalPaymentFees, PaymentType } from "@/lib/fee-estimator";
import { z } from "zod";

const feeEstimateQuerySchema = z.object({
  type: z.enum(["single", "batch", "scheduled"]).default("single"),
  amount: z.string().optional(),
  recipientCount: z.coerce.number().int().min(1).default(1),
  scheduledIntervals: z.coerce.number().int().min(1).default(1),
  protocolFeeBps: z.coerce.number().min(0).max(10000).optional(),
  maxFeeThreshold: z.string().optional(),
});

/**
 * GET /api/fees/estimate — Estimate total fees (network + protocol) before transaction submission.
 */
export const GET = withMetrics(
  "GET /api/fees/estimate",
  withRequestLogging(async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const queryParams = Object.fromEntries(url.searchParams.entries());

      const parseResult = feeEstimateQuerySchema.safeParse(queryParams);
      if (!parseResult.success) {
        return validationError(parseResult.error.flatten().fieldErrors);
      }

      const { type, amount, recipientCount, scheduledIntervals, protocolFeeBps, maxFeeThreshold } =
        parseResult.data;

      const estimate = await estimateTotalPaymentFees({
        paymentType: type as PaymentType,
        amountStroops: amount,
        recipientCount,
        scheduledIntervals,
        protocolFeeBps,
        maxFeeThresholdStroops: maxFeeThreshold,
      });

      return successResponse(estimate);
    } catch (err) {
      return handleApiError(err, "GET /api/fees/estimate");
    }
  })
);

/**
 * POST /api/fees/estimate — Batch/complex fee estimation with JSON payload.
 */
export const POST = withMetrics(
  "POST /api/fees/estimate",
  withRequestLogging(async function POST(request: Request) {
    try {
      const body = await request.json().catch(() => ({}));
      const parseResult = feeEstimateQuerySchema.safeParse(body);
      if (!parseResult.success) {
        return validationError(parseResult.error.flatten().fieldErrors);
      }

      const { type, amount, recipientCount, scheduledIntervals, protocolFeeBps, maxFeeThreshold } =
        parseResult.data;

      const estimate = await estimateTotalPaymentFees({
        paymentType: type as PaymentType,
        amountStroops: amount,
        recipientCount,
        scheduledIntervals,
        protocolFeeBps,
        maxFeeThresholdStroops: maxFeeThreshold,
      });

      return successResponse(estimate);
    } catch (err) {
      return handleApiError(err, "POST /api/fees/estimate");
    }
  })
);
