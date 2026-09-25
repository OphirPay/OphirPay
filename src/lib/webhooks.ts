
import { prisma } from './prisma'

export async function sendWebhook(event: string, request: PaymentRequest) {
  const webhookUrl = await prisma.user.findUnique({
    where: { id: request.requesterId },
    select: { webhookUrl: true }
  })

  if (!webhookUrl?.webhookUrl) return

  await fetch(webhookUrl.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      data: {
        requestId: request.id,
        status: request.status,
        timestamp: new Date().toISOString()
      }
    })
  })
}
