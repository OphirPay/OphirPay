import { formatUnits } from 'ethers';

export function formatTokenAmount(amount: bigint, decimals = 18): string {
  const formatted = formatUnits(amount, decimals);
  return formatted.includes('.') ? formatted : `${formatted}.0`;
}

export function computeClaimableAmount(
  stream: {
    total: bigint;
    vested: bigint;
    claimed: bigint;
    startTime: number;
    endTime: number;
  }
): bigint {
  const now = Math.floor(Date.now() / 1000);
  const duration = stream.endTime - stream.startTime;
  const elapsed = now - stream.startTime;

  if (elapsed <= 0) return 0n;
  if (elapsed >= duration) return stream.total - stream.claimed;

  const vested = (BigInt(elapsed) * stream.total) / BigInt(duration);
  return Math.min(vested - stream.claimed, stream.total - stream.claimed);
}