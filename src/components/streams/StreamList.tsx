import { Stream } from '@/types/stream';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatTokenAmount } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { User } from 'next-auth';

interface StreamListProps {
  streams: Stream[];
  user: User | null;
}

export function StreamList({ streams, user }: StreamListProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stream ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vested</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Claimed</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {streams.map((stream) => (
            <tr key={stream.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {stream.id}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatTokenAmount(stream.total)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatTokenAmount(stream.vested)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {formatTokenAmount(stream.claimed)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <ProgressBar
                  value={stream.vested / stream.total}
                  className="w-24"
                />
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <Button
                  asChild
                  variant="outline"
                  className="mr-2"
                >
                  <a href={`/streams/${stream.id}`}>View</a>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}