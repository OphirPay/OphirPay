import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildQueryParams, parseQueryParams, DEFAULT_QUERY_PARAMS, QueryParams } from '@/lib/query-params';
import { PaymentsTable } from '@/components/PaymentsTable';
import { FiltersBar } from '@/components/FiltersBar';
import { ExportButton } from '@/components/ExportButton';
import { usePayments } from '@/hooks/usePayments';

/**
 * Payments page – the main entry point for the payments list.
 *
 * The component now synchronises its internal state (search, sort, status
 * filter, cursor) with the URL query parameters.  When the user changes any
 * filter or sorting option the URL is updated via `router.replace` without a
 * full navigation.  The cursor is reset whenever the filter set changes to
 * avoid confusing entry points.
 */
export default function PaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialise state from the URL
  const [query, setQuery] = useState<QueryParams>(() =>
    parseQueryParams(searchParams.toString())
  );

  // Keep the URL in sync with the state
  useEffect(() => {
    const qs = buildQueryParams(query);
    router.replace(`?${qs}`, { scroll: false });
  }, [query, router]);

  // Hook that fetches payments based on the current query state
  const { data, isLoading, error, fetchNextPage } = usePayments(query);

  // Handlers that update the state and reset the cursor when filters change
  const handleSearchChange = (value: string) => {
    setQuery((prev) => ({ ...prev, search: value, cursor: undefined }));
  };

  const handleSortChange = (value: string) => {
    setQuery((prev) => ({ ...prev, sort: value, cursor: undefined }));
  };

  const handleStatusChange = (statuses: string[]) => {
    setQuery((prev) => ({ ...prev, status: statuses, cursor: undefined }));
  };

  const handleCursorChange = (newCursor: string | undefined) => {
    setQuery((prev) => ({ ...prev, cursor: newCursor }));
  };

  if (error) {
    return (
      <div className="p-4">
        <p className="text-red-600">Failed to load payments: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <FiltersBar
        search={query.search}
        sort={query.sort}
        status={query.status}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        onStatusChange={handleStatusChange}
      />

      <ExportButton
        query={query}
        disabled={isLoading || !data?.length}
      />

      <PaymentsTable
        payments={data ?? []}
        isLoading={isLoading}
        onLoadMore={fetchNextPage}
        cursor={query.cursor}
        onCursorChange={handleCursorChange}
      />
    </div>
  );
}
