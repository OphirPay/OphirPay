import { formatUnits } from 'viem';

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTokenAmount(amount: bigint, asset: string): string {
  if (asset === 'ETH') {
    return formatUnits(amount, 18);
  } else {
    return formatUnits(amount, 6);
  }
}

export function formatTimestamp(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString();
}