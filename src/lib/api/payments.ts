import { QueryParams } from '@/lib/query-params';
import { Payment } from '@/types/payment';

/**
 * Fetch payments from the backend API.  The API expects the same query
 * parameters that the client uses, so we simply forward them.
 */
export async function fetchPayments(query: QueryParams): Promise<{
  payments: Payment[];
  nextCursor?: string;
}> {
  const qs = new URLSearchParams();

  if (query.search) qs.set('search', query.search);
  if (query.sort) qs.set('sort', query.sort);
  if (query.status?.length) query.status.forEach((s) => qs.append('status', s));
  if (query.cursor) qs.set('cursor', query.cursor);

  const res = await fetch(`/api/payments?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch payments: ${res.statusText}`);
  }
  return res.json();
}
