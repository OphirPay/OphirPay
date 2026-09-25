import { Escrow } from '@/types/escrow';
import { formatAddress, formatTokenAmount, formatTimestamp } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { releaseEscrow, claimEscrow, releaseByArbiter } from '@/lib/escrow-api';

export function EscrowDetail({ escrow }: { escrow: Escrow }) {
  const { address } = useAccount();
  const isOwner = address === escrow.owner;
  const isBeneficiary = address === escrow.beneficiary;
  const isArbiter = address === escrow.arbiter;

  const handleRelease = async () => {
    try {
      await releaseEscrow(escrow.id);
    } catch (error) {
      console.error('Release failed:', error);
    }
  };

  const handleClaim = async () => {
    try {
      await claimEscrow(escrow.id);
    } catch (error) {
      console.error('Claim failed:', error);
    }
  };

  const handleArbiterRelease = async () => {
    try {
      await releaseByArbiter(escrow.id);
    } catch (error) {
      console.error('Arbiter release failed:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-6">
        <h2 className="text-xl font-bold mb-4">Escrow #{escrow.id}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Owner</p>
            <p className="font-medium">{formatAddress(escrow.owner)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Beneficiary</p>
            <p className="font-medium">{formatAddress(escrow.beneficiary)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Amount</p>
            <p className="font-medium">{formatTokenAmount(escrow.amount, escrow.asset)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Asset</p>
            <p className="font-medium">{escrow.asset}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <p className="font-medium">{escrow.status}</p>
          </div>
          {escrow.releaseCondition && (
            <div>
              <p className="text-sm text-gray-500">Release Condition</p>
              <p className="font-medium">{escrow.releaseCondition}</p>
            </div>
          )}
          {escrow.arbiter && (
            <div>
              <p className="text-sm text-gray-500">Arbiter</p>
              <p className="font-medium">{formatAddress(escrow.arbiter)}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200 pb-6">
        <h3 className="text-lg font-medium mb-4">Actions</h3>
        <div className="space-y-2">
          {isOwner && escrow.status === 'LOCKED' && (
            <button
              onClick={handleRelease}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
            >
              Release as Owner
            </button>
          )}
          {isBeneficiary && escrow.status === 'RELEASED' && (
            <button
              onClick={handleClaim}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700"
            >
              Claim Funds
            </button>
          )}
          {isArbiter && escrow.status === 'LOCKED' && (
            <button
              onClick={handleArbiterRelease}
              className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700"
            >
              Release by Arbiter
            </button>
          )}
        </div>
      </div>

      {escrow.releaseCondition && (
        <div>
          <h3 className="text-lg font-medium mb-2">Release Condition</h3>
          <p className="text-gray-600">
            {escrow.releaseCondition}
          </p>
          {escrow.releaseConditionType === 'TIMELOCK' && (
            <p className="text-sm text-gray-500 mt-1">
              Releases at: {formatTimestamp(escrow.releaseTime)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}