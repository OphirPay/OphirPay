import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import './VestingTimeline.css';

const VestingTimeline = ({ startDate, endDate, totalBalance, claimableAmount }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [unlockedAmount, setUnlockedAmount] = useState(0);

  useEffect(() => {
    const calculateUnlockedAmount = () => {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const totalDuration = end - start;
      const elapsed = currentDate - start;
      const unlocked = Math.max(0, Math.min(totalBalance, (elapsed / totalDuration) * totalBalance));
      setUnlockedAmount(unlocked);
    };

    calculateUnlockedAmount();
    const interval = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(interval);
  }, [startDate, endDate, totalBalance, currentDate]);

  return (
    <div className="vesting-timeline">
      <h3>Vesting Timeline</h3>
      <div className="timeline">
        <div className="progress" style={{ width: `${(unlockedAmount / totalBalance) * 100}%` }} />
      </div>
      <div className="info">
        <p>Total Balance: {totalBalance}</p>
        <p>Claimable Amount: {claimableAmount}</p>
        <p>Unlocked Amount: {unlockedAmount}</p>
      </div>
    </div>
  );
};

VestingTimeline.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  totalBalance: PropTypes.number.isRequired,
  claimableAmount: PropTypes.number.isRequired,
};

export default VestingTimeline;