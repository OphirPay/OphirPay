export const REASON_CODE_LABELS = {
  0: 'Unknown',
  1: 'User Requested',
  2: 'Payment Failed',
  3: 'Duplicate Payment',
  4: 'Expiry',
  5: 'Invalid Signature',
  6: 'Insufficient Funds',
  7: 'Contract Reverted',
  8: 'Operator Error',
  99: 'Other',
} as const;

export function getReasonCodeLabel(code: number): string {
  return REASON_CODE_LABELS[code] || 'Unknown';
}