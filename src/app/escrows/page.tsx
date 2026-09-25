import { EscrowList } from '@/components/escrow/EscrowList';
import { getEscrows } from '@/lib/escrow-api';

export default async function EscrowsPage() {
  const escrows = await getEscrows();

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Escrows</h1>
      <EscrowList escrows={escrows} />
    </div>
  );
}