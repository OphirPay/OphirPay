import { Metadata } from 'next';
import { AnalyticsHeader } from '@/components/analytics-header';
import { RefundReasonAnalytics } from '@/components/refund-reason-analytics';
import { getRefundAnalytics } from '@/lib/analytics-data';

export const metadata: Metadata = {
  title: 'Refund Analytics | OphirPay',
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { dateRange?: string };
}) {
  const dateRange = searchParams.dateRange || '30d';
  const analytics = await getRefundAnalytics(dateRange);

  return (
    <div className='container mx-auto px-4 py-8'>
      <AnalyticsHeader />
      <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
        {/* Existing payment metrics components */}
        <div className='md:col-span-2 lg:col-span-3'>
          <RefundReasonAnalytics
            data={analytics.reasonCodes}
            dateRange={dateRange}
          />
        </div>
      </div>
    </div>
  );
}