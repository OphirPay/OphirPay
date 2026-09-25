export type Proposal = {
  id: string;
  proposer: string;
  description: string;
  deposit: string;
  voteCount: {
    for: string;
    against: string;
    abstain: string;
  };
  votingDeadline: number;
  executionDeadline: number;
  state: 'pending' | 'active' | 'passed' | 'failed' | 'executed' | 'cancelled';
  votes: Vote[];
};

export type Vote = {
  voter: string;
  direction: 'for' | 'against' | 'abstain';
};

export type GovernanceConfig = {
  quorum: number;
  threshold: number;
};