import { Request, Response } from 'express';
import { PaymentType } from '../types/payment';
import { FeeBreakdown, FeeEstimateResponse } from '../types/fee';

interface FeeEstimateRequest {
  type: PaymentType;
  amount?: number | number[];
  destination?: string | string[];
  scheduleTime?: string; // ISO 8601 string for scheduled payments
}

export const estimateFee = async (req: Request, res: Response): Promise<void> => {
  const { type, amount, destination, scheduleTime }: FeeEstimateRequest = req.body;

  // Input validation
  if (!type || !['single', 'batch', 'scheduled'].includes(type)) {
    res.status(400).json({ error: 'Invalid or missing payment type. Must be single, batch, or scheduled.' });
    return;
  }

  const baseFee = 0.001; // 0.1% base fee
  const volumeThresholds = [1000, 10000, 100000]; // USD thresholds for tiered discounts
  const volumeMultipliers = [1.0, 0.9, 0.8, 0.7]; // Multipliers for tiers

  let totalAmount = 0;
  let destinations: string[] = [];

  // Extract amounts and destinations based on payment type
  if (type === 'single') {
    if (typeof amount !== 'number' || typeof destination !== 'string') {
      res.status(400).json({ error: 'Single payment requires a single amount (number) and destination (string).' });
      return;
    }
    totalAmount = amount;
    destinations = [destination];
  } else if (type === 'batch') {
    if (!Array.isArray(amount) || !Array.isArray(destination) || amount.length !== destination.length) {
      res.status(400).json({ error: 'Batch payment requires equal-length arrays of amounts and destinations.' });
      return;
    }
    totalAmount = amount.reduce((sum, val) => sum + val, 0);
    destinations = destination;
  } else if (type === 'scheduled') {
    if (typeof amount !== 'number' || typeof destination !== 'string' || !scheduleTime) {
      res.status(400).json({ error: 'Scheduled payment requires amount (number), destination (string), and scheduleTime (ISO 8601).' });
      return;
    }
    totalAmount = amount;
    destinations = [destination];
  }

  // Determine volume tier and multiplier
  let multiplierIndex = 0;
  for (let i = 0; i < volumeThresholds.length; i++) {
    if (totalAmount >= volumeThresholds[i]) {
      multiplierIndex = i + 1;
    }
  }
  const volumeMultiplier = volumeMultipliers[multiplierIndex];

  // Calculate base fee component
  const baseFeeAmount = totalAmount * baseFee * volumeMultiplier;

  // Add schedule premium for scheduled payments
  let schedulePremium = 0;
  let estimatedTime: string | undefined;
  if (type === 'scheduled') {
    const now = new Date();
    const scheduled = new Date(scheduleTime);
    const diffMs = scheduled.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) {
      res.status(400).json({ error: 'Scheduled payment must be at least 1 hour in the future.' });
      return;
    }

    // Premium: 0.05% of amount if ≤24h, 0.02% if >24h
    schedulePremium = diffHours <= 24 ? totalAmount * 0.0005 : totalAmount * 0.0002;
    estimatedTime = scheduled.toISOString();
  }

  const totalFee = baseFeeAmount + schedulePremium;
  const breakdown: FeeBreakdown = {
    baseFee: baseFeeAmount,
    volumeMultiplier,
    schedulePremium,
  };

  const response: FeeEstimateResponse = {
    totalFee,
    breakdown,
    amount: totalAmount,
    destinations,
  };

  if (type === 'scheduled') {
    response.estimatedTime = estimatedTime;
  }

  res.status(200).json(response);
};