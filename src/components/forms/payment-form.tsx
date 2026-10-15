import React, { useEffect, useState } from 'react';
import axios from 'axios';

const TransactionFeeEstimator = () => {
  const [fees, setFees] = useState({ low: 0, normal: 0, fast: 0 });
  const [loading, setLoading] = useState(true);

  const fetchFees = async () => {
    try {
      const response = await axios.get('https://horizon.stellar.org/fee_stats');
      const feeStats = response.data;
      setFees({
        low: feeStats.fee_charged.low,
        normal: feeStats.fee_charged.normal,
        fast: feeStats.fee_charged.fast,
      });
    } catch (error) {
      console.error('Error fetching transaction fees:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, []);

  if (loading) {
    return <div>Loading transaction fees...</div>;
  }

  return (
    <div className="fee-estimator">
      <h3>Transaction Fee Estimator</h3>
      <ul>
        <li>Low: {fees.low} XLM</li>
        <li>Normal: {fees.normal} XLM</li>
        <li>Fast: {fees.fast} XLM</li>
      </ul>
    </div>
  );
};

const PaymentForm = () => {
  return (
    <form>
      {/* Other form fields */}
      <TransactionFeeEstimator />
      <button type="submit">Submit Payment</button>
    </form>
  );
};

export default PaymentForm;