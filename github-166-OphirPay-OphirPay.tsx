import React, { useState, useEffect } from 'react';

interface Payment {
  id: string;
  amountXLM: number;
  timestamp: string;
  status: 'completed' | 'pending' | 'failed';
}

const PaymentsTable: React.FC = () => {
  const [currency, setCurrency] = useState<'XLM' | 'USD'>('XLM');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [conversionRate, setConversionRate] = useState<number>(0.12); // 1 XLM = $0.12 USD (example rate)

  // Load payments and conversion rate on mount
  useEffect(() => {
    const loadPayments = async () => {
      // Simulate API call
      const mockPayments: Payment[] = [
        { id: '1', amountXLM: 100, timestamp: '2026-08-25T10:30:00Z', status: 'completed' },
        { id: '2', amountXLM: 250, timestamp: '2026-08-25T11:45:00Z', status: 'pending' },
        { id: '3', amountXLM: 75, timestamp: '2026-08-25T12:15:00Z', status: 'completed' },
      ];
      setPayments(mockPayments);
    };

    const loadConversionRate = async () => {
      // Simulate fetching live rate
      const rate = 0.12; // In production, fetch from an API like CoinGecko
      setConversionRate(rate);
    };

    loadPayments();
    loadConversionRate();
  }, []);

  // Load currency preference on mount
  useEffect(() => {
    const savedCurrency = localStorage.getItem('ophirpay_currency') as 'XLM' | 'USD';
    if (savedCurrency) {
      setCurrency(savedCurrency);
    }
  }, []);

  // Save currency preference when changed
  useEffect(() => {
    localStorage.setItem('ophirpay_currency', currency);
  }, [currency]);

  const formatAmount = (amountXLM: number): string => {
    if (currency === 'XLM') {
      return `${amountXLM.toFixed(2)} XLM`;
    } else {
      const usdAmount = amountXLM * conversionRate;
      return `$${usdAmount.toFixed(2)}`;
    }
  };

  return (
    <div className="payments-table-container">
      <div className="table-header">
        <h2>Payments</h2>
        <button
          onClick={() => setCurrency(prev => prev === 'XLM' ? 'USD' : 'XLM')}
          className="currency-toggle-btn"
          aria-label={`Switch to ${currency === 'XLM' ? 'USD' : 'XLM'}`}
        >
          {currency === 'XLM' ? 'Switch to USD' : 'Switch to XLM'}
        </button>
      </div>
      <table className="payments-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount ({currency})</th>
            <th>Timestamp</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>{payment.id}</td>
              <td>{formatAmount(payment.amountXLM)}</td>
              <td>{new Date(payment.timestamp).toLocaleString()}</td>
              <td>
                <span className={`status-badge status-${payment.status}`}>
                  {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PaymentsTable;