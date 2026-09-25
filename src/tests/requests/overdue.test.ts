
import { prisma } from '@/lib/prisma'
import { mockDate } from '@/tests/utils'

describe('Payment Request Overdue Handling', () => {
  beforeEach(() => mockDate(new Date('2023-01-01')))

  it('marks requests as overdue after due date', async () => {
    const req = await prisma.paymentRequest.create({
      data: {
        amount: 100,
        dueDate: new Date('2022-12-31'),
        status: 'PENDING'
      }
    })

    await fetch('/api/requests/overdue')
    const updated = await prisma.paymentRequest.findUnique({
      where: { id: req.id }
    })

    expect(updated.status).toBe('OVERDUE')
    expect(updated.overdueAt).toBeDefined()
  })

  it('limits reminders to 3 attempts', async () => {
    const req = await prisma.paymentRequest.create({
      data: {
        amount: 100,
        dueDate: new Date('2022-12-31'),
        status: 'OVERDUE'
      }
    })

    for (let i = 0; i < 3; i++) {
      await fetch('/api/requests/remind', {
        method: 'POST',
        body: JSON.stringify({ requestId: req.id })
      })
    }

    const updated = await prisma.paymentRequest.findUnique({
      where: { id: req.id }
    })
    expect(updated.reminderCount).toBe(3)
  })
})
