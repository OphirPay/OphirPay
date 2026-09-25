import { getStreams } from '@/app/api/streams/route';
import { StreamList } from '@/components/streams/StreamList';
import { getCurrentUser } from '@/lib/session';

export default async function StreamsPage() {
  const user = await getCurrentUser();
  const streams = await getStreams();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Payment Streams</h1>
      <StreamList streams={streams} user={user} />
    </div>
  );
}