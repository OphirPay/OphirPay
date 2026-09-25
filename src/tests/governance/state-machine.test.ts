import { describe, expect, test } from '@jest/globals';
import { getProposalState } from '@/lib/contract-advanced';

describe('Governance Proposal State Machine', () => {
  const now = Math.floor(Date.now() / 1000);

  test('should return pending when voting deadline is in the future', () => {
    const proposalData = {
      votingDeadline: now + 3600,
      executionDeadline: now + 7200,
      voteCount: {
        for: '100',
        against: '50',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('pending');
  });

  test('should return active when voting deadline passed and execution deadline in future', () => {
    const proposalData = {
      votingDeadline: now - 3600,
      executionDeadline: now + 3600,
      voteCount: {
        for: '100',
        against: '50',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('active');
  });

  test('should return passed when votes for > against and quorum reached', () => {
    const proposalData = {
      votingDeadline: now - 3600,
      executionDeadline: now + 3600,
      voteCount: {
        for: '100',
        against: '50',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('passed');
  });

  test('should return failed when votes against >= for', () => {
    const proposalData = {
      votingDeadline: now - 3600,
      executionDeadline: now + 3600,
      voteCount: {
        for: '50',
        against: '100',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('failed');
  });

  test('should return executed when execution deadline passed', () => {
    const proposalData = {
      votingDeadline: now - 7200,
      executionDeadline: now - 3600,
      voteCount: {
        for: '100',
        against: '50',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('executed');
  });

  test('should return cancelled when execution deadline passed without execution', () => {
    const proposalData = {
      votingDeadline: now - 7200,
      executionDeadline: now - 3600,
      voteCount: {
        for: '50',
        against: '100',
        abstain: '20'
      }
    };
    expect(getProposalState(proposalData)).toBe('cancelled');
  });
});