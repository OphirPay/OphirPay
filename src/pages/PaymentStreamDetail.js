import React from 'react';
import VestingTimeline from '../components/VestingTimeline';

const PaymentStreamDetail = ({ paymentStream }) => {
  const { startDate, endDate, totalBalance, claimableAmount } = paymentStream;

  return (
    <div className="payment-stream-detail">
      <h2>Payment Stream Details</h2>
      <VestingTimeline 
        startDate={startDate} 
        endDate={endDate} 
        totalBalance={totalBalance} 
        claimableAmount={claimableAmount} 
      />
    </div>
  );
};

export default PaymentStreamDetail;