import { ethers } from 'ethers';
import { GOVERNANCE_ABI, GOVERNANCE_ADDRESS } from '@/config/contracts';
import { Proposal, Vote, GovernanceConfig } from '@/types/governance';

const provider = new ethers.BrowserProvider(window.ethereum);
const governanceContract = new ethers.Contract(
  GOVERNANCE_ADDRESS,
  GOVERNANCE_ABI,
  provider
);

export const getProposal = async (proposalId: string): Promise<Proposal> => {
  const [proposalData, votes] = await Promise.all([
    governanceContract.getProposal(proposalId),
    getProposalVotes(proposalId)
  ]);

  return {
    id: proposalId,
    proposer: proposalData.proposer,
    description: proposalData.description,
    deposit: ethers.formatEther(proposalData.deposit),
    voteCount: {
      for: proposalData.voteCount.for.toString(),
      against: proposalData.voteCount.against.toString(),
      abstain: proposalData.voteCount.abstain.toString()
    },
    votingDeadline: Number(proposalData.votingDeadline),
    executionDeadline: Number(proposalData.executionDeadline),
    state: getProposalState(proposalData),
    votes
  };
};

export const getProposalVotes = async (proposalId: string): Promise<Vote[]> => {
  const voteCount = await governanceContract.getVoteCount(proposalId);
  const voters = await governanceContract.getVoters(proposalId);

  return voters.map((voter: string) => {
    const direction = voteCount[voter] > 0 ? 'for' :
                     voteCount[voter] < 0 ? 'against' : 'abstain';
    return { voter, direction };
  });
};

export const getGovernanceConfig = async (): Promise<GovernanceConfig> => {
  const config = await governanceContract.getGovernanceConfig();
  return {
    quorum: Number(config.quorum),
    threshold: Number(config.threshold)
  };
};

export const executeProposal = async (proposalId: string): Promise<void> => {
  const signer = await provider.getSigner();
  const tx = await governanceContract.executeProposal(proposalId, { gasLimit: 5000000 });
  await tx.wait();
};

const getProposalState = (proposalData: any): string => {
  const now = Math.floor(Date.now() / 1000);

  if (proposalData.votingDeadline > now) return 'pending';
  if (proposalData.votingDeadline <= now && proposalData.executionDeadline > now) {
    const { for: forVotes, against, abstain } = proposalData.voteCount;
    const totalVotes = forVotes.add(against).add(abstain);
    const votingPower = forVotes.add(against);
    const quorumReached = votingPower.gte(ethers.parseEther('1')); // Simplified for example

    if (!quorumReached) return 'failed';
    if (forVotes.gt(against)) return 'passed';
    return 'failed';
  }
  if (proposalData.executionDeadline <= now) return 'executed';
  return 'cancelled';
};