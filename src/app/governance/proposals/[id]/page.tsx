import { redirect } from 'next/navigation';
import ProposalDetail from '@/components/governance/ProposalDetail';

export default function ProposalPage() {
  return (
    <div>
      <ProposalDetail />
    </div>
  );
}