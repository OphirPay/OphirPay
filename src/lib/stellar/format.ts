/**
 * Formats a Stellar amount (in stroops) to a human-readable string.
 * 1 unit = 10,000,000 stroops (7 decimal places).
 * 
 * @param amount - The amount in stroops (string, number, or bigint)
 * @returns A formatted string representation of the amount
 */
export function formatStellarAmount(amount: string | number | bigint): string {
  if (amount === undefined || amount === null) {
    return '0';
  }

  // Convert to BigInt to ensure precision with MAX_INT64
  let stroops: bigint;
  try {
    stroops = BigInt(amount);
  } catch {
    return '0';
  }

  if (stroops === 0n) return '0';

  const isNegative = stroops < 0n;
  const absoluteStroops = isNegative ? -stroops : stroops;

  const stroopsStr = absoluteStroops.toString().padStart(8, '0');
  const integerPart = stroopsStr.slice(0, -7);
  const fractionalPart = stroopsStr.slice(-7);

  // Remove trailing zeros from the fractional part
  let trimmedFraction = fractionalPart.replace(/0+$/, '');
  
  const result = trimmedFraction.length > 0 
    ? `${integerPart || '0'}.${trimmedFraction}` 
    : (integerPart || '0');

  return isNegative ? `-${result}` : result;
}
