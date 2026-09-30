// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  badRequestError,
  handleApiError,
  notFoundError,
  successResponse,
} from "@/lib/api-response";
import { confirmPaymentRequestSchema } from "@/lib/validation-schemas";
import { verifyCsrf } from "@/lib/csrf";
import {
  expireDuePaymentRequests,
  markPaymentRequestPaid,
  transactionPaysRequest,
} from "@/lib/payment-request-lifecycle";
import { withRequestLogging } from "@/lib/request-logging";

export const POST = withMetrics(
  "POST /api/requests/[id]/paid",
  withRequestLogging(async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;

      const { id } = await params;
      const body = await request.json();
      const parsed = confirmPaymentRequestSchema.safeParse(body);
      if (!parsed.success) {
        return badRequestError("A valid transaction hash is required.");
      }

      await expireDuePaymentRequests();
      const paymentRequest = await prisma.paymentRequest.findUnique({
        where: { id },
      });
      if (!paymentRequest) return notFoundError("Payment request");
      if (paymentRequest.status !== "PENDING") {
        return badRequestError("This payment request is no longer payable.");
      }

      let verified = false;
      try {
        verified = await transactionPaysRequest(
          paymentRequest,
          parsed.data.transactionHash,
        );
      } catch {
        return badRequestError(
          "The transaction could not be verified on the Stellar network.",
        );
      }
      if (!verified) {
        return badRequestError(
          "The transaction does not match this request's recipient, amount, and asset.",
        );
      }

      const markedPaid = await markPaymentRequestPaid(
        id,
        parsed.data.transactionHash,
      );
      if (!markedPaid) {
        return badRequestError("This payment request has already been updated.");
      }
      return successResponse({ status: "PAID" });
    } catch (error) {
      return handleApiError(error, "POST /api/requests/[id]/paid");
    }
  }),
);
