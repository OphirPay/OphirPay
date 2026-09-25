import { NextResponse } from 'next/server';
import { getProposal, getGovernanceConfig } from '@/lib/contract-advanced';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const proposal = await getProposal(params.id);
    const config = await getGovernanceConfig();

    return NextResponse.json({
      success: true,
      data: {
        proposal,
        config,
        votes: proposal.votes || []
      }
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}