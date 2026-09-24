import { useCallback } from 'react';
import { QueryParams } from '@/lib/query-params';

export interface ExportButtonProps {
  query: QueryParams;
  disabled: boolean;
}

export function ExportButton({ query, disabled }: ExportButtonProps) {
  const handleExport = useCallback(async () => {
    const qs = new URLSearchParams();

    if (query.search) qs.set('search', query.search);
    if (query.sort) qs.set('sort', query.sort);
    if (query.status?.length) query.status.forEach((s) => qs.append('status', s));

    // The export endpoint ignores the cursor to avoid exporting partial data
    const res = await fetch(`/api/payments/export?${qs.toString()}`);
    if (!res.ok) {
      alert('Failed to export payments');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payments.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }, [query]);

  return (
    <button
      onClick={handleExport}
      disabled={disabled}
      className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
    >
      Export CSV
    </button>
  );
}
