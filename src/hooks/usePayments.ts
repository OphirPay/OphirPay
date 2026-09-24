import { useQuery } from '@tanstack/react-query';
import { QueryParams } from '@/lib/query-params';
import { fetchPayments } from '@/lib/api/payments';

/**
 * Custom hook that fetches a page of payments based on the provided query
 * parameters.  It returns the data, loading state, error, and a helper to
 * fetch the next page using the cursor returned by the API.
 */
export function usePayments(query: QueryParams) {
  const { data, isLoading, error, refetch } = useQuery(
    ['payments', query],
    () => fetchPayments(query),
    {
      keepPreviousData: true,
      staleTime: 5_000,
    }
  );

  const fetchNextPage = () => {
    if (!data?.nextCursor) return;
    refetch({ query: { ...query, cursor: data.nextCursor } });
  };

  return {
    data: data?.payments ?? [],
    isLoading,
    error,
    fetchNextPage,
  };
}
