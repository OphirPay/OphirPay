// SPDX-License-Identifier: MIT
import { withMetrics } from "@/lib/metrics-middleware";
import { handleApiError, successResponse, unauthorizedError } from "@/lib/api-response";
import { getAuthContext } from "@/lib/auth-session";
import { cachedFetch } from "@/lib/api-cache";
import { CHAIN_READ_SOURCE, DEFAULT_CONTRACT_ID, simulateContractCall } from "@/lib/contracts";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { withRequestLogging } from "@/lib/request-logging";
import prisma from "@/lib/prisma";

export const GET = withMetrics("GET /api/governance/proposals/[id]", withRequestLogging(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");

    const { id: rawId } = await params;
    if (!/^\d+$/.test(rawId) || Number(rawId) < 1) {
      return Response.json({ success: false, error: { code: "INVALID_ID", message: "Proposal ID must be a positive integer." } }, { status: 400 });
    }
    const proposalId = Number(rawId);
    const [proposal, config] = await Promise.all([
      cachedFetch(
        `gov:proposal:${proposalId}`,
        () => simulateContractCall(DEFAULT_CONTRACT_ID, "get_proposal", CHAIN_READ_SOURCE, [nativeToScVal(proposalId, { type: "u64" })]),
        30_000,
      ),
      cachedFetch(
        "gov:config",
        () => simulateContractCall(DEFAULT_CONTRACT_ID, "get_governance_config", CHAIN_READ_SOURCE),
        30_000,
      ),
    ]);

    if (proposal.status === "SIMULATION_FAILED" || !proposal.returnValue) {
      return Response.json({ success: false, error: { code: "NOT_FOUND", message: `Governance proposal ${proposalId} was not found on-chain.` } }, { status: 404 });
    }

    const voteHistory = await prisma.auditLog.findMany({
      where: { action: "governance:vote", target: String(proposalId) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { actor: true, details: true, createdAt: true },
    }).catch(() => []);

    return successResponse({
      proposal: proposal.returnValue,
      config: config.status === "SIMULATION_FAILED" ? null : config.returnValue ?? null,
      voteHistory: voteHistory.map((entry) => ({
        voter: typeof entry.details === "object" && entry.details !== null && "voter" in entry.details
          ? String(entry.details.voter)
          : null,
        support: typeof entry.details === "object" && entry.details !== null && "support" in entry.details
          ? Boolean(entry.details.support)
          : null,
        transactionHash: typeof entry.details === "object" && entry.details !== null && "txHash" in entry.details
          ? String(entry.details.txHash ?? "") || null
          : null,
        recordedAt: entry.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err, "GET /api/governance/proposals/[id]");
  }
}));