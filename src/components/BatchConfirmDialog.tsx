import React, { useState, useCallback } from 'react';

interface Recipient {
  address: string;
  amount: string;
  asset: string;
}

interface BatchConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recipients: Recipient[];
  totalAmount: string;
}

export const BatchConfirmDialog: React.FC<BatchConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  recipients,
  totalAmount,
}) => {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleCopy = useCallback(async (address: string) => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard API not available');
      }
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      
      // Reset tooltip after 2 seconds
      setTimeout(() => {
        setCopiedAddress(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
      // Graceful handling: we don't show the tooltip if it fails
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">
          Confirm Batch Payout
        </h2>
        
        <div className="max-h-96 overflow-y-auto mb-6">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-2">Recipient Address</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recipients.map((recipient, index) => (
                <tr key={`${recipient.address}-${index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="relative px-4 py-3 font-mono text-xs">
                    <button
                      onClick={() => handleCopy(recipient.address)}
                      className="group flex items-center gap-2 transition-colors hover:text-blue-600 focus:outline-none"
                      title="Click to copy address"
                    >
                      <span className="truncate max-w-[250px] sm:max-w-md">
                        {recipient.address}
                      </span>
                      
                      {/* Tooltip UI */}
                      {copiedAddress === recipient.address && (
                        <span 
                          className="absolute -top-2 left-1/2 -translate-x-1/2 transform rounded bg-gray-900 px-2 py-1 text-[10px] text-white animate-in fade-in zoom-in duration-200"
                          role="status"
                          aria-live="polite"
                        >
                          Copied!
                        </span>
                      )}
                      
                      <svg 
                        className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {recipient.amount} {recipient.asset}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div>
            <p className="text-sm text-gray-500">Total to be sent:</p>
            <p className="text-lg font-bold text-blue-600">{totalAmount}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Confirm & Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
