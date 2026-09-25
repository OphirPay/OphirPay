import { EscrowDetail } from '@/components/escrow/EscrowDetail';
import { getEscrowById } from '@/lib/escrow-api';

export default async function EscrowDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const escrow = await getEscrowById(params.id);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <EscrowDetail escrow={escrow} />
    </div>
  );
}