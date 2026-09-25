import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Proposal, Vote, GovernanceConfig } from '@/types/governance';
import { getProposal, getGovernanceConfig, executeProposal } from '@/lib/contract-advanced';
import { formatAddress, formatTimestamp } from '@/lib/utils';
import styles from '@/styles/governance.module.css';

type ProposalDetailProps = {
  proposal: Proposal | null;
  config: GovernanceConfig | null;
  votes: Vote[];
  loading: boolean;
  error: string | null;
  onExecute: () => void;
};

const ProposalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [config, setConfig] = useState<GovernanceConfig | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [proposalData, configData, votesData] = await Promise.all([
          getProposal(id),
          getGovernanceConfig(),
          getProposal(id).then(p => p.votes || [])
        ]);
        setProposal(proposalData);
        setConfig(configData);
        setVotes(votesData);
      } catch (err) {
        setError('Failed to load proposal data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleExecute = async () => {
    try {
      await executeProposal(id);
      setProposal(prev => prev ? { ...prev, state: 'executed' } : null);
    } catch (err) {
      setError(err.message || 'Execution failed');
    }
  };

  if (loading) return <div className={styles.loading}>Loading...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!proposal) return <div className={styles.notFound}>Proposal not found</div>;

  const getStateClass = () => {
    const { state } = proposal;
    return {
      pending: styles.pending,
      active: styles.active,
      passed: styles.passed,
      failed: styles.failed,
      executed: styles.executed,
      cancelled: styles.cancelled,
    }[state] || styles.pending;
  };

  const canExecute = proposal.state === 'passed' &&
                    new Date().getTime() / 1000 >= proposal.executionDeadline;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Proposal #{id}</h1>
        <div className={`${styles.stateBadge} ${getStateClass()}`}>
          {proposal.state}
        </div>
      </div>

      <div className={styles.section}>
        <h2>Metadata</h2>
        <div className={styles.metadata}>
          <div><strong>Proposer:</strong> {formatAddress(proposal.proposer)}</div>
          <div><strong>Deposit:</strong> {proposal.deposit} OP</div>
          <div><strong>Description:</strong> {proposal.description}</div>
        </div>
      </div>

      {config && (
        <div className={styles.section}>
          <h2>Governance Configuration</h2>
          <div className={styles.config}>
            <div><strong>Quorum:</strong> {config.quorum}%</div>
            <div><strong>Threshold:</strong> {config.threshold}%</div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h2>Voting</h2>
        <div className={styles.voteTally}>
          <div className={styles.voteCounts}>
            <div>For: {proposal.voteCount.for}</div>
            <div>Against: {proposal.voteCount.against}</div>
            <div>Abstain: {proposal.voteCount.abstain}</div>
          </div>
          <div className={styles.voteHistory}>
            <h3>Votes ({votes.length})</h3>
            <ul>
              {votes.map((vote, index) => (
                <li key={index} className={styles.voteItem}>
                  <div className={styles.voter}>{formatAddress(vote.voter)}</div>
                  <div className={styles.voteDirection}>{vote.direction}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.timers}>
        <div>
          <strong>Voting Ends:</strong> {formatTimestamp(proposal.votingDeadline)}
        </div>
        <div>
          <strong>Execution Window Ends:</strong> {formatTimestamp(proposal.executionDeadline)}
        </div>
      </div>

      {canExecute && (
        <button
          className={styles.executeButton}
          onClick={handleExecute}
        >
          Execute Proposal
        </button>
      )}
    </div>
  );
};

export default ProposalDetail;