// Existing imports...

export const POST = withMetrics("POST /api/payments/retry", withRequestLogging(async function POST(
  req: Request
) {
  try {
    const { paymentId } = await req.json();
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      return formatProblemDetails({
        type: "/errors/not-found",
        title: "Payment Not Found",
        status: 404,
        detail: `No payment with ID ${paymentId}`,
      });
    }

    // ... existing retry logic ...

  } catch (err) {
    return formatProblemDetails({
      type: "/errors/internal",
      title: "Retry Failed",
      status: 500,
      detail: "Could not retry payment",
    });
  }
}));
