
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendWebhook } from '@/lib/webhooks'
import { sendNotification } from '@/lib/notifications'

// Overdue transition job
export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/requests/overdue') return NextResponse.next()

  const now = new Date()
  const overdueRequests = await prisma.paymentRequest.findMany({
    where: {
      status: 'PENDING',
      dueDate: { lt: now },
      overdueAt: null
    }
  })

  for (const req of overdueRequests) {
    await prisma.paymentRequest.update({
      where: { id: req.id },
      data: {
        status: 'OVERDUE',
        overdueAt: now
      }
    })

    // Emit webhook and notification
    await sendWebhook('request_overdue', req)
    await sendNotification(req.requesterId, 'request_overdue', req)
  }

  return NextResponse.json({ success: true })
}

// Reminder endpoint
export async function POST(request: Request) {
  const { requestId } = await request.json()
  const req = await prisma.paymentRequest.findUnique({
    where: { id: requestId, status: 'OVERDUE' }
  })

  if (!req || req.reminderCount >= 3) {
    return NextResponse.json({ error: 'Invalid request or limit reached' }, { status: 400 })
  }

  await prisma.paymentRequest.update({
    where: { id: requestId },
    data: {
      reminderCount: { increment: 1 },
      lastReminderSent: new Date()
    }
  })

  await sendNotification(req.requesterId, 'request_reminder', req)
  return NextResponse.json({ success: true })
}
