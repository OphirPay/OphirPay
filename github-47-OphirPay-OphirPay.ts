// src/components/PaymentStatus/PaymentStatus.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { PaymentStatus as PaymentStatusType } from '../../types/payment';

interface PaymentStatusProps {
  paymentId: string;
  initialStatus: PaymentStatusType;
  onUpdateStatus: (paymentId: string, newStatus: PaymentStatusType) => Promise<void>;
}

const PaymentStatus: React.FC<PaymentStatusProps> = ({ 
  paymentId, 
  initialStatus, 
  onUpdateStatus 
}) => {
  const [status, setStatus] = useState<PaymentStatusType>(initialStatus);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optimistic update handler
  const handleStatusChange = useCallback(async (newStatus: PaymentStatusType) => {
    // Optimistically update UI
    const previousStatus = status;
    setStatus(newStatus);
    setIsProcessing(true);
    setError(null);

    try {
      await onUpdateStatus(paymentId, newStatus);
    } catch (err) {
      // Rollback on failure
      setStatus(previousStatus);
      setError(err instanceof Error ? err.message : 'Failed to update payment status');
    } finally {
      setIsProcessing(false);
    }
  }, [status, paymentId, onUpdateStatus]);

  // Reconcile with server state (e.g., on mount or periodic sync)
  useEffect(() => {
    if (initialStatus !== status && !isProcessing) {
      setStatus(initialStatus);
    }
  }, [initialStatus, status, isProcessing]);

  const getStatusColor = (s: PaymentStatusType) => {
    switch (s) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
        {status}
      </span>
      {isProcessing && (
        <span className="text-xs text-blue-600 animate-pulse">Updating...</span>
      )}
      {error && (
        <span className="text-xs text-red-600" role="alert">{error}</span>
      )}
    </div>
  );
};

export default PaymentStatus;