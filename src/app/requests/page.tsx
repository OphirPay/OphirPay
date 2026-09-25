
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'

export default async function RequestsPage() {
  const requests = await prisma.paymentRequest.findMany({
    where: { requesterId: 'current-user-id' },
    orderBy: { dueDate: 'asc' }
  })

  return (
    <div className="requests-grid">
      {requests.map(request => (
        <div key={request.id} className={`request-card ${request.status === 'OVERDUE' ? 'overdue' : ''}`}>
          <div className="request-status">
            {request.status === 'OVERDUE' && (
              <span className="overdue-badge">OVERDUE</span>
            )}
            {request.status}
          </div>
          <div className="request-amount">
            {formatCurrency(request.amount, request.currency)}
          </div>
          {request.status === 'OVERDUE' && (
            <div className="reminder-info">
              Reminders sent: {request.reminderCount}/3
              <button
                onClick={() => remindRequest(request.id)}
                disabled={request.reminderCount >= 3}
              >
                Send Reminder
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

async function remindRequest(requestId: string) {
  const res = await fetch('/api/requests/remind', {
    method: 'POST',
    body: JSON.stringify({ requestId })
  })
  if (res.ok) window.location.reload()
}
