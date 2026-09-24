// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";

import {
  successResponse,
  notFound,
  handleApiError,
  unauthorizedError,
  badRequest,
} from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import {
  simulateContractCall,
  DEFAULT_CONTRACT_ID,
  CHAIN_READ_SOURCE,
} from "@/lib/contracts";
import { cachedFetch } from "@/lib/api-cache";
import {
  getProposalStatus,
  canExecuteProposal,
  formatDuration,
  getProposalVotes,
  DEFAULT_GOVERNANCE_CONFIG,
  type Proposal,
  type GovernanceConfig,
  type ProposalDetail,
} from "@/lib/governance";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";

export const GET = withMetrics(
  "GET /api/governance/proposals/[id]",
  withRequestLogging(async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) {
    try {
      const auth = await getAuthContext(request);
      if (!auth) {
        return unauthorizedError(
          "Authentication required. Connect your wallet or provide an API key."
        );
      }

      const { id: rawId } = await context.params;
      const proposalId = parseInt(rawId, 10);
      if (isNaN(proposalId) || proposalId <= 0) {
        return badRequest("Valid numeric proposal ID is required");
      }

      // Fetch on-chain proposal
      const proposalResult = await cachedFetch(
        `gov:proposal:${proposalId}`,
        () =>
          simulateContractCall(
            DEFAULT_CONTRACT_ID,
            "get_proposal",
            CHAIN_READ_SOURCE,
            [nativeToScVal(proposalId, { type: "u64" })]
          ),
        15_000
      );

      if (
        proposalResult.status === "SIMULATION_FAILED" ||
        !proposalResult.returnValue
      ) {
        return notFound(`Governance proposal #${proposalId} not found`);
      }

      const raw = proposalResult.returnValue as Record<string, unknown>;

      const proposal: Proposal = {
        id: Number(raw.id ?? proposalId),
        title: String(raw.title ?? `Proposal #${proposalId}`),
        description: String(raw.description ?? ""),
        action_type: String(raw.action_type ?? "custom"),
        target: String(raw.target ?? ""),
        data: String(raw.data ?? ""),
        yes_votes: Number(raw.yes_votes ?? 0),
        no_votes: Number(raw.no_votes ?? 0),
        voting_ends_at: raw.voting_ends_at ? Number(raw.voting_ends_at) : null,
        executed: Boolean(raw.executed),
        created_at: raw.created_at ? Number(raw.created_at) : null,
        proposer: String(raw.proposer ?? ""),
        deposit_asset: String(raw.deposit_asset ?? ""),
        deposit_amount: raw.deposit_amount ? String(raw.deposit_amount) : "0",
      };

      // Fetch on-chain governance config
      const configResult = await cachedFetch(
        "gov:config",
        () =>
          simulateContractCall(
            DEFAULT_CONTRACT_ID,
            "get_governance_config",
            CHAIN_READ_SOURCE
          ),
        60_000
      );

      let config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG;
      if (
        configResult.status !== "SIMULATION_FAILED" &&
        configResult.returnValue
      ) {
        const rawConfig = configResult.returnValue as Record<string, unknown>;
        config = {
          min_proposal_deposit: rawConfig.min_proposal_deposit
            ? String(rawConfig.min_proposal_deposit)
            : DEFAULT_GOVERNANCE_CONFIG.min_proposal_deposit,
          voting_period: rawConfig.voting_period
            ? Number(rawConfig.voting_period)
            : DEFAULT_GOVERNANCE_CONFIG.voting_period,
          quorum_bps: rawConfig.quorum_bps
            ? Number(rawConfig.quorum_bps)
            : DEFAULT_GOVERNANCE_CONFIG.quorum_bps,
          enabled: rawConfig.enabled !== undefined
            ? Boolean(rawConfig.enabled)
            : DEFAULT_GOVERNANCE_CONFIG.enabled,
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const status = getProposalStatus(proposal, config, now);
      const execCheck = canExecuteProposal(proposal, now);
      const votes = getProposalVotes(proposalId, proposal);

      const totalVotes = proposal.yes_votes + proposal.no_votes;
      const targetPercentage = (config.quorum_bps ?? 5100) / 100;
      const thresholdMet = proposal.yes_votes > proposal.no_votes;

      const votingEnds = proposal.voting_ends_at ?? 0;
      const remainingSeconds = Math.max(0, votingEnds - now);

      const detail: ProposalDetail = {
        ...proposal,
        status,
        config,
        canExecute: execCheck.canExecute,
        reasonNotExecutable: execCheck.reason,
        quorum: {
          targetBps: config.quorum_bps,
          targetPercentage,
          yesVotes: proposal.yes_votes,
          noVotes: proposal.no_votes,
          totalVotes,
          thresholdMet,
        },
        votingTiming: {
          startsAt: proposal.created_at,
          endsAt: proposal.voting_ends_at,
          isOpen: status === "active",
          remainingSeconds,
          formattedRemaining: formatDuration(remainingSeconds),
        },
        executionTiming: {
          opensAt: proposal.voting_ends_at,
          isOpen: execCheck.canExecute,
          executed: proposal.executed,
        },
        votes,
      };

      return successResponse(detail);
    } catch (err) {
      return handleApiError(err, "GET /api/governance/proposals/[id]");
    }
  })
);
