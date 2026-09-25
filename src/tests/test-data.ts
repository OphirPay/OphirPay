export const mockEscrow = {
  id: '1',
  owner: '0xOwner',
  beneficiary: '0xBeneficiary',
  amount: 1000000000000000000n, // 1 ETH
  asset: 'ETH',
  status: 'LOCKED',
  arbiter: '0xArbiter',
  releaseCondition: '0xCondition',
  releaseConditionType: 'TIMELOCK',
  releaseTime: BigInt(Date.now() + 3600000), // 1 hour from now
};

export const mockEscrows = [
  mockEscrow,
  {
    ...mockEscrow,
    id: '2',
    owner: '0xOwner2',
    beneficiary: '0xBeneficiary2',
    amount: 2000000000000000000n, // 2 ETH
    status: 'RELEASED',
  },
];
