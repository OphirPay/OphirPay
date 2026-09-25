import { ethers } from 'ethers';
import { contractABI, contractAddress } from './constants';
import { getProvider, getSigner } from './provider';

export async function computeVestedAmount(
  streamId: string,
  recipient: string
): Promise<bigint> {
  const provider = getProvider();
  const contract = new ethers.Contract(contractAddress, contractABI, provider);

  const stream = await contract.streams(streamId);
  const now = Math.floor(Date.now() / 1000);

  // Replicate on-chain vesting logic
  const startTime = stream.startTime.toNumber();
  const endTime = stream.endTime.toNumber();
  const duration = endTime - startTime;
  const elapsed = now - startTime;

  if (elapsed <= 0) return 0n;
  if (elapsed >= duration) return stream.totalAmount;

  const progress = BigInt(elapsed) * BigInt(stream.totalAmount) / BigInt(duration);
  return progress;
}

export async function claimStream(streamId: string): Promise<void> {
  const signer = getSigner();
  const contract = new ethers.Contract(contractAddress, contractABI, signer);

  const tx = await contract.claimStream(streamId);
  await tx.wait();
}

export async function cancelStream(streamId: string): Promise<void> {
  const signer = getSigner();
  const contract = new ethers.Contract(contractAddress, contractABI, signer);

  const tx = await contract.cancelStream(streamId);
  await tx.wait();
}