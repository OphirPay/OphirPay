import { notFound } from 'next/navigation';
import { getStream } from '@/app/api/streams/[id]/route';
import { StreamDetail } from '@/components/streams/StreamDetail';
import { getCurrentUser } from '@/lib/session';

export default async function StreamPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const stream = await getStream(params.id);

  if (!stream) return notFound();

  return (
    <div className="container mx-auto px-4 py-8">
      <StreamDetail stream={stream} user={user} />
    </div>
  );
}