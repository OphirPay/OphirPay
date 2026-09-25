import { Stream } from '@/types/stream';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatTokenAmount } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { User } from 'next-auth';
import { ClaimStreamButton } from './ClaimStreamButton';
import { CancelStreamButton } from './CancelStreamButton';

interface StreamDetailProps {
  stream: Stream;
  user: User | null;
}

export function StreamDetail({ stream, user }: StreamDetailProps) {
  const isCreator = user?.address === stream.creator;
  const isRecipient = user?.address === stream.recipient;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Stream #{stream.id}</h2>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-sm text-gray-500">Total Amount</p>
            <p className="text-lg font-medium">{formatTokenAmount(stream.total)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Vested Amount</p>
            <p className="text-lg font-medium">{formatTokenAmount(stream.vested)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Claimed Amount</p>
            <p className="text-lg font-medium">{formatTokenAmount(stream.claimed)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Remaining</p>
            <p className="text-lg font-medium">
              {formatTokenAmount(stream.total - stream.claimed - stream.vested)}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-2">Vesting Progress</p>
          <ProgressBar
            value={stream.vested / stream.total}
            label={`${Math.round((stream.vested / stream.total) * 100)}%`}
          />
        </div>

        <div className="flex space-x-4">
          {isRecipient && stream.claimable > 0 && (
            <ClaimStreamButton streamId={stream.id} />
          )}
          {isCreator && (
            <CancelStreamButton streamId={stream.id} />
          )}
        </div>
      </div>
    </div>
  );
}