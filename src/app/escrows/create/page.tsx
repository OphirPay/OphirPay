import { EscrowCreateForm } from '@/components/escrow/EscrowCreateForm';
import { createEscrow } from '@/lib/escrow-api';

export default function EscrowCreatePage() {
  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create Escrow</h1>
      <EscrowCreateForm onSubmit={createEscrow} />
    </div>
  );
}