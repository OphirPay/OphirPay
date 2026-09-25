import { ethers } from 'ethers';
import { ophirPayContract } from './contract-config';

export async function getRefundReasonAnalytics(
  startDate: string,
  endDate: string
): Promise<Array<{ reason_code: number; count: number; timestamp: string }>> {
  const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
  const contract = ophirPayContract(provider);

  // Get the most recent 100 refunds within the date range
  const refunds = await contract.get_reason_code_analytics();

  // Filter and aggregate by reason code
  const aggregated = refunds.reduce((acc, entry) => {
    const reasonCode = entry.reason_code;
    const timestamp = new Date(entry.timestamp * 1000).toISOString();

    if (timestamp >= startDate && timestamp <= endDate) {
      if (!acc[reasonCode]) {
        acc[reasonCode] = { reason_code: reasonCode, count: 0, timestamps: [] };
      }
      acc[reasonCode].count += 1;
      acc[reasonCode].timestamps.push(timestamp);
    }
    return acc;
  }, {} as Record<number, { reason_code: number; count: number; timestamps: string[] }>);

  // Convert to array and add timestamp for each entry
  return Object.values(aggregated).flatMap((entry) => {
    return entry.timestamps.map((timestamp) => ({
      reason_code: entry.reason_code,
      count: 1, // Individual entry count
      timestamp,
    }));
  });
}