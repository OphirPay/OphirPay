// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import prisma from "@/lib/prisma";
import {
  badRequestError,
  handleApiError,
  notFoundError,
  successResponse,
  unauthorizedError,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { verifyCsrf } from "@/lib/csrf";
import { sendEmail } from "@/lib/email";
import { expireDuePaymentRequests } from "@/lib/payment-request-lifecycle";
import { withRequestLogging } from "@/lib/request-logging";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const POST = withMetrics(
  "POST /api/requests/[id]/remind",
  withRequestLogging(async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    try {
      const csrfError = verifyCsrf(request);
      if (csrfError) return csrfError;
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key.",
        );
      }

      await expireDuePaymentRequests();
      const { id } = await params;
      const paymentRequest = await prisma.paymentRequest.findFirst({
        where: { id, userId: auth.userId },
      });
      if (!paymentRequest) return notFoundError("Payment request");
      if (paymentRequest.status !== "PENDING") {
        return badRequestError("Only outstanding requests can be reminded.");
      }
      if (!paymentRequest.recipientEmail) {
        return badRequestError("Add a payer email address before sending a reminder.");
      }
      if (!paymentRequest.recipientAddress) {
        return badRequestError("Add a recipient address before sending a reminder.");
      }

      const now = new Date();
      const cooldownEnd = new Date(now.getTime() - REMINDER_COOLDOWN_MS);
      const claimed = await prisma.paymentRequest.updateMany({
        where: {
          id,
          userId: auth.userId,
          status: "PENDING",
          OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: cooldownEnd } }],
        },
        data: { lastReminderAt: now },
      });
      if (claimed.count === 0) {
        return badRequestError("A reminder was already sent within the last 24 hours.");
      }

      const amount = `${paymentRequest.amount.toString()} ${paymentRequest.assetCode}`;
      const baseUrl = (
        process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app"
      ).replace(/\/$/, "");
      const invoiceUrl = `${baseUrl}/pay/${encodeURIComponent(paymentRequest.recipientAddress || "")}?requestId=${encodeURIComponent(paymentRequest.id)}`;
      try {
        await sendEmail({
          to: paymentRequest.recipientEmail,
          subject: `Reminder: payment of ${amount} is due`,
          html: `<p>This is a reminder that a payment of <strong>${amount}</strong> is due.</p>${paymentRequest.description ? `<p>${paymentRequest.description.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)}</p>` : ""}<p><a href="${invoiceUrl}">View and pay this request</a></p>`,
          text: `This is a reminder that a payment of ${amount} is due.${paymentRequest.description ? ` ${paymentRequest.description}` : ""} View and pay: ${invoiceUrl}`,
        });
      } catch (error) {
        await prisma.paymentRequest.updateMany({
          where: { id, userId: auth.userId, lastReminderAt: now },
          data: { lastReminderAt: paymentRequest.lastReminderAt },
        });
        throw error;
      }
      return successResponse({ sent: true, sentAt: now.toISOString() });
    } catch (error) {
      return handleApiError(error, "POST /api/requests/[id]/remind");
    }
  }),
);
