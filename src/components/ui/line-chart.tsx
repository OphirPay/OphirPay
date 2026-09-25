import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface LineChartProps {
  dataKey: string;
  series: Array<{
    label: string;
    data: Array<{ timestamp: string; value: number }>;
  }>;
  className?: string;
}

export function LineChart({ dataKey, series, className }: LineChartProps) {
  const chartData = {
    labels: series.flatMap((s) => s.data.map((d) => d.timestamp)),
    datasets: series.map((s) => ({
      label: s.label,
      data: s.data.map((d) => d.value),
      borderColor: getColorForLabel(s.label),
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.1,
      fill: true,
    })),
  };

  return (
    <div className={className}>
      <Line
        data={chartData}
        options={{
          responsive: true,
          plugins: {
            legend: { position: 'top' as const },
          },
          scales: {
            x: { type: 'time', time: { unit: 'day' } },
            y: { beginAtZero: true },
          },
        }}
      />
    </div>
  );
}

function getColorForLabel(label: string): string {
  const colors = {
    'User Requested': '#3b82f6',
    'Payment Failed': '#ef4444',
    'Duplicate Payment': '#f59e0b',
    'Expiry': '#8b5cf6',
    'Invalid Signature': '#10b981',
    'Insufficient Funds': '#ec4899',
    'Contract Reverted': '#6b7280',
    'Operator Error': '#06b6d4',
    'Unknown': '#9ca3af',
    'Other': '#d1d5db',
  };
  return colors[label] || '#6b7280';
}