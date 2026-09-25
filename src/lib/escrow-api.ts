import { Escrow, EscrowCreateParams } from '@/types/escrow';
import { contractConfig } from './contract-advanced';
import { createPublicClient, http } from 'viem';
import { ophirpayABI } from '@/abis/ophirpay';

const client = createPublicClient({
  transport: http(),
});

export async function getEscrows(): Promise<Escrow[]> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'getAllEscrows',
  });
  const escrows = await client.call({ ...request, from: contractConfig.address });
  return escrows.map((escrow: any, index: number) => ({
    id: index.toString(),
    ...escrow,
  }));
}

export async function getEscrowById(id: string): Promise<Escrow> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'getEscrow',
    args: [BigInt(id)],
  });
  const escrow = await client.call({ ...request, from: contractConfig.address });
  return {
    id,
    ...escrow,
  };
}

export async function createEscrow(params: EscrowCreateParams): Promise<void> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'createEscrow',
    args: [
      params.beneficiary,
      params.amount,
      params.asset,
      params.arbiter || '0x0000000000000000000000000000000000000000',
      params.releaseCondition || '0x',
    ],
  });
  await client.call({ ...request, from: contractConfig.address });
}

export async function releaseEscrow(id: string): Promise<void> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'releaseEscrow',
    args: [BigInt(id)],
  });
  await client.call({ ...request, from: contractConfig.address });
}

export async function claimEscrow(id: string): Promise<void> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'claimEscrow',
    args: [BigInt(id)],
  });
  await client.call({ ...request, from: contractConfig.address });
}

export async function releaseByArbiter(id: string): Promise<void> {
  const { request } = await client.simulateContract({
    address: contractConfig.address,
    abi: ophirpayABI,
    functionName: 'releaseByArbiter',
    args: [BigInt(id)],
  });
  await client.call({ ...request, from: contractConfig.address });
}