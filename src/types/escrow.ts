export interface Escrow {
  id: string;
  owner: string;
  beneficiary: string;
  amount: bigint;
  asset: string;
  status: 'LOCKED' | 'RELEASED' | 'CLAIMED';
  arbiter?: string;
  releaseCondition?: string;
  releaseConditionType?: 'TIMELOCK' | 'CONDITION';
  releaseTime?: bigint;
}

export interface EscrowCreateParams {
  beneficiary: string;
  amount: bigint;
  asset: string;
  arbiter?: string;
  releaseCondition?: string;
}