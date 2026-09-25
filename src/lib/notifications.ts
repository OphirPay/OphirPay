
import { prisma } from './prisma'
import { sendEmail } from './email'

export async function sendNotification(
  userId: string,
  event: 'request_overdue' | 'request_reminder' | 'request_paid',
  request: PaymentRequest
) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.emailPreferences.includes(event)) return

  const subject = event === 'request_overdue'
    ? 'Your payment request is overdue'
    : event === 'request_reminder'
      ? 'Reminder: Payment request still outstanding'
      : 'Your payment request has been paid'

  await sendEmail({
    to: user.email,
    subject,
    html: renderNotificationTemplate(event, request)
  })
}

function renderNotificationTemplate(event: string, request: PaymentRequest): string {
  // Implementation omitted for brevity - uses request details and event type
  return `<div>${event === 'request_overdue'
    ? 'Your request is now overdue'
    : event === 'request_reminder'
      ? `This is reminder #${request.reminderCount}`
      : 'Your payment has been received'}</div>`
}
