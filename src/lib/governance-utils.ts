import { ethers } from 'ethers';
import { GOVERNANCE_ABI, GOVERNANCE_ADDRESS } from '@/config/contracts';

const provider = new ethers.BrowserProvider(window.ethereum);
const governanceContract = new ethers.Contract(
  GOVERNANCE_ADDRESS,
  GOVERNANCE_ABI,
  provider
);

export const canExecuteProposal = async (proposalId: string): Promise<boolean> => {
  const proposal = await governanceContract.getProposal(proposalId);
  const now = Math.floor(Date.now() / 1000);

  if (proposal.executionDeadline <= now) return false;

  const { for: forVotes, against } = proposal.voteCount;
  return forVotes.gt(against);
};

export const getProposalError = async (proposalId: string): Promise<string | null> => {
  try {
    await governanceContract.executeProposal(proposalId, { gasLimit: 5000000 });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown contract error';
  }
};