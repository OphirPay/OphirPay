import { Payment } from '@/types/payment';
import { useEffect, useRef } from 'react';

export interface PaymentsTableProps {
  payments: Payment[];
  isLoading: boolean;
  onLoadMore: () => void;
  cursor?: string;
  onCursorChange: (cursor: string | undefined) => void;
}

export function PaymentsTable({
  payments,
  isLoading,
  onLoadMore,
  cursor,
  onCursorChange,
}: PaymentsTableProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor) {
          onLoadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, onLoadMore]);

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="border px-2 py-1">ID</th>
          <th className="border px-2 py-1">Amount</th>
          <th className="border px-2 py-1">Status</th>
          <th className="border px-2 py-1">Created At</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}>
            <td className="border px-2 py-1">{p.id}</td>
            <td className="border px-2 py-1">{p.amount}</td>
            <td className="border px-2 py-1">{p.status}</td>
            <td className="border px-2 py-1">{new Date(p.createdAt).toLocaleString()}</td>
          </tr>
        ))}
        {isLoading && (
          <tr>
            <td colSpan={4} className="text-center py-4">
              Loading...
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} ref={sentinelRef} className="h-1"></td>
        </tr>
      </tfoot>
    </table>
  );
}
