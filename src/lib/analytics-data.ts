import { getReasonCodeLabel } from './constants';

export async function getRefundAnalytics(dateRange: string) {
  const startDate = getDateRangeStart(dateRange);
  const endDate = getDateRangeEnd(dateRange);

  const response = await fetch(
    `/api/analytics?type=refund-reasons&start=${startDate}&end=${endDate}`,
    { next: { revalidate: 3600 } }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch refund analytics');
  }

  const data = await response.json();
  return {
    reasonCodes: data.map((entry: any) => ({
      reasonCode: entry.reason_code,
      count: entry.count,
      timestamp: entry.timestamp,
      label: getReasonCodeLabel(entry.reason_code),
    })),
  };
}

function getDateRangeStart(range: string): string {
  const now = new Date();
  switch (range) {
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
}

function getDateRangeEnd(range: string): string {
  return new Date().toISOString();
}