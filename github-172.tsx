// components/RecurringPaymentPicker.tsx
'use client';

import { useState, useEffect } from 'react';
import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';

type Frequency = 'weekly' | 'biweekly' | 'monthly';

interface RecurringPaymentPickerProps {
  initialAmount?: number;
  initialFrequency?: Frequency;
}

const RecurringPaymentPicker: React.FC<RecurringPaymentPickerProps> = ({
  initialAmount = 100,
  initialFrequency = 'monthly',
}) => {
  const [frequency, setFrequency] = useState<Frequency>(initialFrequency);
  const [nextRunDate, setNextRunDate] = useState<Date>(new Date());

  useEffect(() => {
    const calculateNextRun = () => {
      const today = startOfDay(new Date());
      let nextDate: Date;

      switch (frequency) {
        case 'weekly':
          nextDate = addWeeks(today, 1);
          break;
        case 'biweekly':
          nextDate = addWeeks(today, 2);
          break;
        case 'monthly':
          nextDate = addMonths(today, 1);
          break;
        default:
          nextDate = today;
      }

      setNextRunDate(nextDate);
    };

    calculateNextRun();
  }, [frequency]);

  const frequencyOptions: { value: Frequency; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Bi-Weekly (Every 2 Weeks)' },
    { value: 'monthly', label: 'Monthly' },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-4">Recurring Payment Setup</h2>
      
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Payment Frequency
        </label>
        <div className="grid grid-cols-3 gap-3">
          {frequencyOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFrequency(option.value)}
              className={`px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                frequency === option.value
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-600">Next Payment</p>
            <p className="text-lg font-semibold text-gray-900">
              {nextRunDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Amount</p>
            <p className="text-lg font-bold text-indigo-700">
              ${initialAmount.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecurringPaymentPicker;