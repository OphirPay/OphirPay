// components/TransactionFeePreview.tsx
'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { calculateFee } from '@/lib/feeEstimator';

interface TransactionFeePreviewProps {
  amount: string;
  recipient: string;
  onConfirm: (fee: string) => void;
  onCancel: () => void;
}

export default function TransactionFeePreview({
  amount,
  recipient,
  onConfirm,
  onCancel,
}: TransactionFeePreviewProps) {
  const { network } = useWallet();
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFee = async () => {
      if (!amount || !recipient) return;

      setLoading(true);
      setError(null);
      try {
        const fee = await calculateFee(amount, recipient, network);
        setEstimatedFee(fee);
      } catch (err) {
        setError('Failed to estimate fee');
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchFee, 300); // Debounce
    return () => clearTimeout(timeoutId);
  }, [amount, recipient, network]);

  const handleConfirm = () => {
    if (estimatedFee) {
      onConfirm(estimatedFee);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Transaction Fee Preview
        </h2>
        
        <div className="space-y-3 mb-6">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-300">Amount:</span>
            <span className="font-medium text-gray-900 dark:text-white">{amount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-300">Recipient:</span>
            <span className="font-medium text-gray-900 dark:text-white truncate max-w-[200px]">
              {recipient}
            </span>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600 dark:text-gray-300">Estimated Fee:</span>
            <div className="flex items-center">
              {loading ? (
                <span className="text-gray-500 dark:text-gray-400 animate-pulse">Calculating...</span>
              ) : error ? (
                <span className="text-red-500">{error}</span>
              ) : (
                <span className="font-bold text-green-600 dark:text-green-400">
                  {estimatedFee || '0'} XLM
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!estimatedFee || loading || !!error}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Confirm & Submit
          </button>
        </div>
      </div>
    </div>
  );
}