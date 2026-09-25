import Link from 'next/link';
import { Proposal } from '@/types/governance';
import styles from '@/styles/governance.module.css';

type GovernanceProposalsListProps = {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
};

const GovernanceProposalsList = ({ proposals, loading, error }: GovernanceProposalsListProps) => {
  if (loading) return <div className={styles.loading}>Loading proposals...</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div className={styles.listContainer}>
      <h1 className={styles.title}>Governance Proposals</h1>
      <div className={styles.list}>
        {proposals.map((proposal) => (
          <Link
            key={proposal.id}
            href={`/governance/proposals/${proposal.id}`}
            className={styles.proposalCard}
          >
            <div className={styles.proposalId}>#{proposal.id}</div>
            <div className={styles.proposalTitle}>{proposal.description}</div>
            <div className={styles.proposalState}>
              {proposal.state}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default GovernanceProposalsList;