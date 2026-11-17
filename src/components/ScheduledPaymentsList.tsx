import React, { useState, useMemo } from 'react';
import { Search, X, Calendar, ArrowRight } from 'lucide-react';
// Assuming these are standard UI components in the project
// If specific UI library components are preferred, they can be swapped
import { Input } from '@/components/ui/input'; 
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';

interface Payment {
  id: string;
  recipient: string;
  amount: string;
  currency: string;
  memo?: string;
  nextPaymentDate: string;
  status: 'active' | 'paused' | 'completed';
}

interface ScheduledPaymentsListProps {
  payments: Payment[];
  isLoading?: boolean;
}

export const ScheduledPaymentsList: React.FC<ScheduledPaymentsListProps> = ({ 
  payments = [], 
  isLoading 
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPayments = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return payments;

    return payments.filter((payment) => {
      const matchesRecipient = payment.recipient.toLowerCase().includes(query);
      const matchesMemo = payment.memo?.toLowerCase().includes(query);
      return matchesRecipient || matchesMemo;
    });
  }, [payments, searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  if (isLoading) {
    return <div className="flex justify-center p-8">Loading payments...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Search Section */}
      <div className="relative w-full max-w-md">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <Search className="w-4 h-4 text-gray-400" />
        </div>
        <Input
          type="text"
          placeholder="Search by address or memo..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
        />
        {searchQuery && (
          <button
            onClick={handleClearSearch}
            className="absolute inset-y-0 right-0 flex items-center pr-3 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* Payments List */}
      <div className="mt-4">
        {filteredPayments.length > 0 ? (
          <div className="grid gap-4">
            {filteredPayments.map((payment) => (
              <div 
                key={payment.id} 
                className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-mono text-gray-500 truncate max-w-[200px] md:max-w-xs">
                    {payment.recipient}
                  </span>
                  {payment.memo && (
                    <span className="text-sm font-medium text-gray-900">
                      {payment.memo}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-bold">
                      {payment.amount} {payment.currency}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                      <Calendar className="w-3 h-3" />
                      Next: {payment.nextPaymentDate}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={searchQuery ? "No matches found" : "No scheduled payments"}
            description={
              searchQuery 
                ? `We couldn't find any payments matching "${searchQuery}"`
                : "You don't have any scheduled payments yet."
            }
            action={searchQuery ? { label: "Clear search", onClick: handleClearSearch } : undefined}
          />
        )}
      </div>
    </div>
  );
};

export default ScheduledPaymentsList;
