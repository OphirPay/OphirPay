// Existing imports...

export const POST = withMetrics("POST /api/payments/cancel", withRequestLogging(async function POST(
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

    // ... existing cancellation logic ...

  } catch (err) {
    return formatProblemDetails({
      type: "/errors/internal",
      title: "Cancellation Failed",
      status: 500,
      detail: "Could not cancel payment",
    });
  }
}));
