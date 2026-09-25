import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { getReasonCodeLabel } from '@/lib/constants';
import { LineChart } from '@/components/ui/line-chart';
import { DateRangeSelector } from '@/components/date-range-selector';

interface RefundReasonAnalyticsProps {
  data: Array<{
    reasonCode: number;
    count: number;
    timestamp: string;
  }>;
  dateRange: string;
}

export function RefundReasonAnalytics({
  data,
  dateRange,
}: RefundReasonAnalyticsProps) {
  const reasonCodeData = data.reduce((acc, entry) => {
    const label = getReasonCodeLabel(entry.reasonCode);
    if (!acc[entry.reasonCode]) {
      acc[entry.reasonCode] = { label, counts: [] };
    }
    acc[entry.reasonCode].counts.push({
      timestamp: entry.timestamp,
      value: entry.count,
    });
    return acc;
  }, {} as Record<number, { label: string; counts: Array<{ timestamp: string; value: number }> }>);

  const series = Object.entries(reasonCodeData).map(([code, { label, counts }]) => ({
    label,
    data: counts,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refund Reason Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='flex justify-between items-center mb-4'>
          <h3 className='text-sm font-medium text-muted-foreground'>
            Most recent 100 refunds ({dateRange} window)
          </h3>
          <DateRangeSelector defaultValue={dateRange} />
        </div>
        {series.length === 0 ? (
          <div className='text-center py-8 text-muted-foreground'>
            No refund reason data available
          </div>
        ) : (
          <ChartContainer config={{ series }}>
            <LineChart
              dataKey='timestamp'
              series={series}
              className='h-[300px]'
            />
            <ChartTooltip>
              <ChartTooltipContent />
            </ChartTooltip>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}