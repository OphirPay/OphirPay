
import { prisma } from '@/lib/prisma'
import { formatCurrency } from '@/lib/format'

export default async function PayPage({ params }: { params: { address: string } }) {
  const request = await prisma.paymentRequest.findUnique({
    where: { id: params.address }
  })

  return (
    <div className={`pay-page ${request?.status === 'OVERDUE' ? 'overdue' : ''}`}>
      <div className="pay-amount">
        {formatCurrency(request?.amount, request?.currency)}
      </div>
      {request?.status === 'OVERDUE' && (
        <div className="overdue-notice">
          This request is overdue. Please pay as soon as possible.
        </div>
      )}
      {/* ... existing payment form ... */}
    </div>
  )
}
