import { useState } from 'react';
import { useAccount } from 'wagmi';
import { EscrowCreateParams } from '@/types/escrow';
import { formatEther, parseEther } from 'viem';

export function EscrowCreateForm({ onSubmit }: { onSubmit: (params: EscrowCreateParams) => Promise<void> }) {
  const { address } = useAccount();
  const [formData, setFormData] = useState({
    beneficiary: '',
    amount: '',
    asset: 'ETH',
    arbiter: '',
    releaseCondition: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit({
        beneficiary: formData.beneficiary,
        amount: parseEther(formData.amount),
        asset: formData.asset,
        arbiter: formData.arbiter || undefined,
        releaseCondition: formData.releaseCondition || undefined,
      });
    } catch (error) {
      console.error('Failed to create escrow:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="beneficiary" className="block text-sm font-medium text-gray-700">
          Beneficiary Address
        </label>
        <input
          type="text"
          id="beneficiary"
          value={formData.beneficiary}
          onChange={(e) => setFormData({ ...formData, beneficiary: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          required
        />
      </div>
      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
          Amount (ETH)
        </label>
        <input
          type="number"
          id="amount"
          step="0.0001"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          required
        />
      </div>
      <div>
        <label htmlFor="asset" className="block text-sm font-medium text-gray-700">
          Asset
        </label>
        <select
          id="asset"
          value={formData.asset}
          onChange={(e) => setFormData({ ...formData, asset: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        >
          <option value="ETH">ETH</option>
          <option value="USDC">USDC</option>
        </select>
      </div>
      <div>
        <label htmlFor="arbiter" className="block text-sm font-medium text-gray-700">
          Arbiter Address (optional)
        </label>
        <input
          type="text"
          id="arbiter"
          value={formData.arbiter}
          onChange={(e) => setFormData({ ...formData, arbiter: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label htmlFor="releaseCondition" className="block text-sm font-medium text-gray-700">
          Release Condition (optional)
        </label>
        <input
          type="text"
          id="releaseCondition"
          value={formData.releaseCondition}
          onChange={(e) => setFormData({ ...formData, releaseCondition: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      </div>
      <button
        type="submit"
        className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Create Escrow
      </button>
    </form>
  );
}