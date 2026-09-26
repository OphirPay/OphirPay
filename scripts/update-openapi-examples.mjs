#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const SPEC_PATH = path.join(process.cwd(), "docs", "openapi.yaml");
let content = fs.readFileSync(SPEC_PATH, "utf8");

// We will construct the data dictionary of request examples and response examples.
// Request examples for the 28 operations accepting requestBody:
const REQUEST_EXAMPLES = {
  "POST /api/payments": {
    amount: 150.0,
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    assetCode: "USDC",
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    description: "Consulting invoice payout #0881",
    memo: "INV-2026-001"
  },
  "PATCH /api/payments/{id}": {
    status: "COMPLETED",
    description: "Updated invoice description",
    memo: "INV-2026-001"
  },
  "POST /api/payments/retry": {
    id: "pay_98234ab1c09d"
  },
  "POST /api/payments/cancel": {
    id: "pay_98234ab1c09d"
  },
  "POST /api/escrows": {
    payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    amount: 5000000000,
    assetCode: "USDC",
    releaseAfter: 1735689600,
    memo: "ESCROW-MILESTONE-1"
  },
  "POST /api/streams": {
    payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    amount: 10000000000,
    assetCode: "USDC",
    startTime: 1724695200,
    endTime: 1727287200,
    memo: "STREAM-SALARY"
  },
  "POST /api/batches": {
    name: "August Payroll Distribution",
    description: "Monthly contractor payouts",
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    recipients: [
      {
        address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        amount: 3200.0,
        assetCode: "USDC",
        memo: "PAYROLL-ENG-01"
      },
      {
        address: "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
        amount: 2850.0,
        assetCode: "USDC",
        memo: "PAYROLL-ENG-02"
      }
    ]
  },
  "POST /api/recurring": {
    name: "Cloud Server Hosting",
    frequency: "MONTHLY",
    amount: 49.0,
    assetCode: "USDC",
    destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    description: "Monthly recurring infrastructure bill"
  },
  "PATCH /api/recurring": {
    id: "rec_009941a8",
    paused: true
  },
  "POST /api/scheduled": {
    amount: 500.0,
    assetCode: "USDC",
    destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    scheduledAt: "2026-09-01T00:00:00.000Z",
    memo: "SEP-BONUS"
  },
  "POST /api/requests": {
    amount: 1500.0,
    assetCode: "USDC",
    description: "Design Systems consulting retainer",
    recipientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
  },
  "POST /api/webhooks": {
    url: "https://backend.example.com/api/webhooks/ophirpay",
    events: ["payment.completed", "payment.failed", "escrow.released"],
    isActive: true
  },
  "POST /api/webhooks/{id}/replay": {
    since: "2026-08-25T00:00:00.000Z",
    until: "2026-08-26T00:00:00.000Z",
    limit: 50
  },
  "POST /api/keys": {
    name: "Production Backend Worker",
    scopes: ["payments:read", "payments:write", "webhooks:manage"]
  },
  "PATCH /api/keys": {
    id: "key_01hv89q7a4mpx3n",
    scopes: ["payments:read"]
  },
  "POST /api/auth/session": {
    publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    signature: "c3ab41d9e2b10a9c8f7e6d5c4b3a210f9e8d7c6b5a412039485761a2b3c4d5e6f7"
  },
  "POST /api/multisig": {
    threshold: 2,
    signers: [
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2"
    ],
    enabled: true
  },
  "POST /api/multisig/propose": {
    payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    amount: 1000.0,
    assetCode: "USDC",
    memo: "MULTISIG-PAY-01"
  },
  "POST /api/multisig/approve": {
    requestId: 1
  },
  "POST /api/multisig/execute": {
    requestId: 1
  },
  "POST /api/governance/proposals": {
    proposer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    title: "Reduce Base Fee to 10 BPS",
    description: "Proposal to decrease base transfer fee across all payments",
    actionType: "update_fee",
    target: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    data: "0000000a",
    depositAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    depositAmount: 100000000
  },
  "POST /api/governance/vote": {
    proposalId: 1,
    voter: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    support: true
  },
  "POST /api/governance/execute": {
    proposalId: 1
  },
  "POST /api/refunds": {
    paymentId: 1024,
    amount: 2500000000,
    asset: "USDC",
    reason: "Product damaged in shipping",
    reasonCode: 1,
    onChainId: 12
  },
  "PATCH /api/refunds/{id}": {
    status: "APPROVED"
  },
  "POST /api/hooks": {
    eventType: "payment.completed",
    webhookUrl: "https://backend.example.com/api/hooks",
    onChainId: 4
  },
  "PATCH /api/hooks/{id}": {
    active: false
  },
  "POST /api/jobs/process-due-recurring": {
    limit: 10
  }
};

// Response examples for all 85 operations + special codes:
const RESPONSE_EXAMPLES = {
  "GET /api/payments 200": {
    data: [
      {
        id: "pay_98234ab1c09d",
        amount: 150.0,
        assetCode: "USDC",
        assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        description: "Consulting invoice payout #0881",
        memo: "INV-2026-001",
        status: "COMPLETED",
        transactionHash: "9b12a84efc713b194d3f5481d9f8e4c3a2105e6b7d8c9a0f1e2d3c4b5a6f7e8d",
        sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        userId: "usr_01hv89q7a4mpx3n",
        batchId: null,
        createdAt: "2026-08-26T18:15:00.000Z",
        completedAt: "2026-08-26T18:15:04.000Z",
        errorMessage: null
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
      hasMore: false,
      nextCursor: null
    }
  },
  "POST /api/payments 201": {
    id: "pay_98234ab1c09d",
    amount: 150.0,
    assetCode: "USDC",
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    description: "Consulting invoice payout #0881",
    memo: "INV-2026-001",
    status: "PENDING",
    transactionHash: null,
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    userId: "usr_01hv89q7a4mpx3n",
    batchId: null,
    createdAt: "2026-08-26T18:15:00.000Z",
    completedAt: null,
    errorMessage: null
  },
  "GET /api/payments/{id} 200": {
    id: "pay_98234ab1c09d",
    amount: 150.0,
    assetCode: "USDC",
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    description: "Consulting invoice payout #0881",
    memo: "INV-2026-001",
    status: "COMPLETED",
    transactionHash: "9b12a84efc713b194d3f5481d9f8e4c3a2105e6b7d8c9a0f1e2d3c4b5a6f7e8d",
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    userId: "usr_01hv89q7a4mpx3n",
    batchId: null,
    createdAt: "2026-08-26T18:15:00.000Z",
    completedAt: "2026-08-26T18:15:04.000Z",
    errorMessage: null
  },
  "PATCH /api/payments/{id} 200": {
    success: true,
    data: {
      id: "pay_98234ab1c09d",
      status: "COMPLETED",
      description: "Updated invoice description",
      memo: "INV-2026-001",
      updatedAt: "2026-08-26T18:25:00.000Z"
    }
  },
  "DELETE /api/payments/{id} 200": {
    success: true,
    data: {
      id: "pay_98234ab1c09d",
      deleted: true,
      deletedAt: "2026-08-26T18:30:00.000Z"
    }
  },
  "POST /api/payments/retry 200": {
    id: "pay_98234ab1c09d",
    amount: 150.0,
    assetCode: "USDC",
    status: "PENDING",
    idempotencyKey: "retry_8f7b2c9e4a1d",
    sourceAccountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    userId: "usr_01hv89q7a4mpx3n",
    createdAt: "2026-08-26T18:15:00.000Z"
  },
  "POST /api/payments/cancel 200": {
    success: true,
    data: {
      id: "pay_98234ab1c09d",
      status: "CANCELLED",
      cancelledAt: "2026-08-26T18:20:00.000Z"
    }
  },
  "GET /api/payments/export 200": "id,amount,assetCode,status,destAddress,createdAt\npay_98234ab1c09d,150.00,USDC,COMPLETED,GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN,2026-08-26T18:15:00.000Z",
  "GET /api/escrows 200": {
    success: true,
    data: [
      {
        id: "escrow_019a48f2",
        contractAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        status: "FUNDED",
        amount: 5000000000,
        assetCode: "USDC",
        payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        releaseAfter: 1735689600,
        createdAt: "2026-08-26T18:45:00.000Z"
      }
    ]
  },
  "POST /api/escrows 201": {
    success: true,
    data: {
      id: "escrow_019a48f2",
      contractAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      status: "FUNDED",
      amount: 5000000000,
      assetCode: "USDC",
      payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      releaseAfter: 1735689600,
      createdAt: "2026-08-26T18:45:00.000Z"
    }
  },
  "GET /api/escrows/{id} 200": {
    success: true,
    data: {
      id: "escrow_019a48f2",
      contractAddress: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      status: "FUNDED",
      amount: 5000000000,
      assetCode: "USDC",
      payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      releaseAfter: 1735689600,
      createdAt: "2026-08-26T18:45:00.000Z"
    }
  },
  "GET /api/streams 200": {
    success: true,
    data: [
      {
        id: "stream_4418a99b",
        streamAddress: "CCQ75YJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC019",
        status: "ACTIVE",
        totalDeposit: 10000000000,
        ratePerSecond: 3858,
        payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        startTime: 1724695200,
        endTime: 1727287200,
        createdAt: "2026-08-26T18:50:00.000Z"
      }
    ]
  },
  "POST /api/streams 201": {
    success: true,
    data: {
      id: "stream_4418a99b",
      streamAddress: "CCQ75YJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC019",
      status: "ACTIVE",
      totalDeposit: 10000000000,
      ratePerSecond: 3858,
      payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      startTime: 1724695200,
      endTime: 1727287200,
      createdAt: "2026-08-26T18:50:00.000Z"
    }
  },
  "GET /api/streams/{id} 200": {
    success: true,
    data: {
      id: "stream_4418a99b",
      streamAddress: "CCQ75YJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC019",
      status: "ACTIVE",
      totalDeposit: 10000000000,
      ratePerSecond: 3858,
      withdrawnAmount: 2500000000,
      remainingBalance: 7500000000,
      payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      startTime: 1724695200,
      endTime: 1727287200
    }
  },
  "GET /api/timelock 200": {
    success: true,
    data: {
      actions: [
        {
          actionId: 1,
          target: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          eta: 1724781600,
          executed: false,
          proposedAt: 1724695200
        }
      ]
    }
  },
  "GET /api/rbac 200": {
    success: true,
    data: {
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      roles: ["admin", "operator"],
      permissions: ["payments:write", "multisig:propose"]
    }
  },
  "GET /api/fee-config 200": {
    success: true,
    data: {
      baseFeeBps: 15,
      minFeeStroops: 10000,
      maxFeeStroops: 5000000,
      feeCollector: "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2",
      updatedAt: "2026-08-26T18:00:00.000Z"
    }
  },
  "GET /api/fee-config/collector 200": {
    success: true,
    data: {
      feeCollector: "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2"
    }
  },
  "GET /api/fee-config/history 200": {
    success: true,
    data: [
      {
        version: 2,
        baseFeeBps: 15,
        updatedBy: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        effectiveAt: "2026-08-26T18:00:00.000Z"
      }
    ]
  },
  "GET /api/policy-versions 200": {
    success: true,
    data: {
      versions: [
        {
          version: 1,
          type: "fee_policy",
          hash: "3f9821a0b4e5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1",
          timestamp: 1724695200
        }
      ]
    }
  },
  "GET /api/contracts 200": {
    success: true,
    data: {
      contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      version: "0.1.0",
      owner: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      network: "testnet"
    }
  },
  "GET /api/stats 200": {
    success: true,
    data: {
      totalPayments: 1250,
      totalBatches: 85,
      totalEscrows: 42,
      totalStreams: 18,
      totalVolumeStroops: 950000000000
    }
  },
  "GET /api/batches 200": {
    success: true,
    data: [
      {
        id: "batch_7710a9c82e",
        name: "August Payroll Distribution",
        status: "COMPLETED",
        totalAmount: 6050.0,
        recipientCount: 2,
        createdAt: "2026-08-26T18:30:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1,
      hasMore: false,
      nextCursor: null
    }
  },
  "POST /api/batches 200": {
    success: true,
    data: {
      id: "batch_7710a9c82e",
      name: "August Payroll Distribution",
      status: "CREATED",
      totalAmount: 6050.0,
      recipientCount: 2,
      createdAt: "2026-08-26T18:30:00.000Z"
    },
    meta: {
      deduplicated: true
    }
  },
  "POST /api/batches 201": {
    success: true,
    data: {
      id: "batch_7710a9c82e",
      name: "August Payroll Distribution",
      status: "CREATED",
      totalAmount: 6050.0,
      recipientCount: 2,
      createdAt: "2026-08-26T18:30:00.000Z"
    }
  },
  "GET /api/batches/{id} 200": {
    success: true,
    data: {
      id: "batch_7710a9c82e",
      userId: "usr_01hv89q7a4mpx3n",
      name: "August Payroll Distribution",
      description: "Monthly contractor payouts",
      status: "COMPLETED",
      items: [
        {
          id: "pay_98234ab1c09d",
          amount: 3200.0,
          assetCode: "USDC",
          status: "sent",
          memo: "PAYROLL-ENG-01"
        }
      ],
      progress: {
        total: 2,
        pending: 0,
        sent: 2,
        failed: 0
      },
      createdAt: "2026-08-26T18:30:00.000Z",
      updatedAt: "2026-08-26T18:31:00.000Z"
    }
  },
  "POST /api/batches/{id} 200": {
    success: true,
    data: {
      batchId: "batch_7710a9c82e",
      cancelled: 2,
      skipped: 0,
      total: 2
    },
    meta: {
      timestamp: "2026-08-26T18:31:00.000Z"
    }
  },
  "GET /api/batches/summary 200": {
    success: true,
    data: {
      counts: {
        CREATED: 1,
        PROCESSING: 2,
        COMPLETED: 15,
        PARTIALLY_COMPLETED: 0,
        FAILED: 1,
        total: 19
      },
      progress: {
        total: 120,
        pending: 15,
        sent: 100,
        failed: 5
      }
    }
  },
  "GET /api/recurring 200": {
    success: true,
    data: [
      {
        id: "rec_009941a8",
        name: "Cloud Server Hosting",
        status: "ACTIVE",
        destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        assetCode: "USDC",
        amount: 49.0,
        frequency: "MONTHLY",
        nextExecution: "2026-09-26T18:35:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1
    }
  },
  "POST /api/recurring 201": {
    success: true,
    data: {
      id: "rec_009941a8",
      name: "Cloud Server Hosting",
      status: "ACTIVE",
      frequency: "MONTHLY",
      amount: 49.0,
      assetCode: "USDC",
      destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      nextExecution: "2026-09-26T18:35:00.000Z",
      createdAt: "2026-08-26T18:35:00.000Z"
    }
  },
  "PATCH /api/recurring 200": {
    success: true,
    data: {
      id: "rec_009941a8",
      status: "PAUSED",
      paused: true,
      updatedAt: "2026-08-26T18:40:00.000Z"
    }
  },
  "GET /api/recurring/{id} 200": {
    success: true,
    data: {
      id: "rec_009941a8",
      name: "Cloud Server Hosting",
      status: "ACTIVE",
      frequency: "MONTHLY",
      amount: 49.0,
      assetCode: "USDC",
      destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      nextExecution: "2026-09-26T18:35:00.000Z",
      createdAt: "2026-08-26T18:35:00.000Z"
    }
  },
  "PATCH /api/recurring/{id} 200": {
    success: true,
    data: {
      id: "rec_009941a8",
      status: "DEACTIVATED",
      active: false,
      deactivatedAt: "2026-08-26T18:45:00.000Z"
    }
  },
  "GET /api/scheduled 200": {
    success: true,
    data: [
      {
        id: "sch_991823ab",
        destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        amount: 500.0,
        assetCode: "USDC",
        scheduledAt: "2026-09-01T00:00:00.000Z",
        status: "SCHEDULED"
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1
    }
  },
  "POST /api/scheduled 201": {
    success: true,
    data: {
      id: "sch_991823ab",
      destAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      amount: 500.0,
      assetCode: "USDC",
      scheduledAt: "2026-09-01T00:00:00.000Z",
      status: "SCHEDULED",
      createdAt: "2026-08-26T18:50:00.000Z"
    }
  },
  "DELETE /api/scheduled 200": {
    success: true,
    data: {
      id: "sch_991823ab",
      status: "CANCELLED",
      cancelledAt: "2026-08-26T18:55:00.000Z"
    }
  },
  "GET /api/scheduled/run 200": {
    success: true,
    data: {
      picked: 3,
      executed: 3,
      failed: 0,
      skipped: 0,
      timestamp: "2026-08-26T19:00:00.000Z"
    }
  },
  "POST /api/scheduled/run 200": {
    success: true,
    data: {
      picked: 3,
      executed: 3,
      failed: 0,
      skipped: 0,
      timestamp: "2026-08-26T19:00:00.000Z"
    }
  },
  "GET /api/requests 200": {
    success: true,
    data: [
      {
        id: "req_88194fbc",
        paymentUrl: "https://ophirpay.com/pay/req_88194fbc",
        status: "OPEN",
        amount: 1500.0,
        assetCode: "USDC",
        expiresAt: "2026-08-29T18:40:00.000Z",
        createdAt: "2026-08-26T18:40:00.000Z"
      }
    ]
  },
  "POST /api/requests 201": {
    success: true,
    data: {
      id: "req_88194fbc",
      paymentUrl: "https://ophirpay.com/pay/req_88194fbc",
      status: "OPEN",
      amount: 1500.0,
      assetCode: "USDC",
      expiresAt: "2026-08-29T18:40:00.000Z",
      createdAt: "2026-08-26T18:40:00.000Z"
    }
  },
  "GET /api/webhooks 200": {
    success: true,
    data: [
      {
        id: "wh_019a99824c",
        url: "https://backend.example.com/api/webhooks/ophirpay",
        events: ["payment.completed", "payment.failed"],
        isActive: true,
        createdAt: "2026-08-26T19:05:00.000Z"
      }
    ]
  },
  "POST /api/webhooks 201": {
    success: true,
    data: {
      id: "wh_019a99824c",
      url: "https://backend.example.com/api/webhooks/ophirpay",
      events: ["payment.completed", "payment.failed", "escrow.released"],
      secret: "sec_mock_webhook_example_8f7b2c9e4a1d",
      isActive: true,
      createdAt: "2026-08-26T19:05:00.000Z"
    }
  },
  "PATCH /api/webhooks 200": {
    success: true,
    data: {
      id: "wh_019a99824c",
      secret: "sec_mock_new_secret_returned_once_9f2d",
      rotatedAt: "2026-08-26T19:10:00.000Z"
    }
  },
  "DELETE /api/webhooks 200": {
    success: true,
    data: {
      id: "wh_019a99824c",
      deleted: true,
      deletedAt: "2026-08-26T19:15:00.000Z"
    }
  },
  "GET /api/webhooks/{id} 200": {
    success: true,
    data: {
      id: "wh_019a99824c",
      url: "https://backend.example.com/api/webhooks/ophirpay",
      events: ["payment.completed", "payment.failed"],
      isActive: true,
      createdAt: "2026-08-26T19:05:00.000Z"
    }
  },
  "POST /api/webhooks/{id}/test 200": {
    delivered: true,
    status: "delivered",
    event: "payment.completed",
    test: true,
    durationMs: 145,
    sentAt: "2026-08-26T19:15:00.000Z"
  },
  "POST /api/webhooks/{id}/replay 200": {
    success: true,
    data: {
      replayedCount: 12,
      successfulCount: 12,
      failedCount: 0
    }
  },
  "GET /api/webhooks/{id}/deliveries 200": {
    success: true,
    data: [
      {
        id: "del_01884abc",
        webhookId: "wh_019a99824c",
        event: "payment.completed",
        statusCode: 200,
        success: true,
        durationMs: 110,
        attemptedAt: "2026-08-26T19:10:00.000Z"
      }
    ]
  },
  "POST /api/webhooks/{id}/deliveries/{deliveryId}/redeliver 200": {
    success: true,
    data: {
      id: "del_01884abd",
      previousDeliveryId: "del_01884abc",
      statusCode: 200,
      success: true,
      attemptedAt: "2026-08-26T19:20:00.000Z"
    }
  },
  "GET /api/keys 200": {
    success: true,
    data: [
      {
        id: "key_01hv89q7a4mpx3n",
        name: "Production Backend Worker",
        prefix: "oph_8f7b2c9e4a1d",
        scopes: ["payments:read", "payments:write", "webhooks:manage"],
        lastUsed: "2026-08-26T18:05:00.000Z",
        createdAt: "2026-08-26T18:00:00.000Z"
      }
    ]
  },
  "POST /api/keys 201": {
    success: true,
    data: {
      id: "key_01hv89q7a4mpx3n",
      name: "Production Backend Worker",
      prefix: "oph_8f7b2c9e4a1d",
      scopes: ["payments:read", "payments:write", "webhooks:manage"],
      key: "oph_8f7b2c9e4a1d0f62b8e3c1a93817f39a48b021ef9a7c3d2e"
    }
  },
  "PATCH /api/keys 200": {
    success: true,
    data: {
      id: "key_01hv89q7a4mpx3n",
      scopes: ["payments:read"]
    }
  },
  "DELETE /api/keys 200": {
    message: "API key revoked successfully."
  },
  "GET /api/keys/stats 200": {
    success: true,
    data: {
      window: "24h",
      totalRequests: 8420,
      activeKeys: 4,
      usageByKey: [
        {
          id: "key_01hv89q7a4mpx3n",
          name: "Production Backend Worker",
          requests: 7910
        }
      ]
    }
  },
  "POST /api/auth/session 200": {
    success: true,
    data: {
      authenticated: true,
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      issuedAt: "2026-08-26T18:00:00.000Z"
    }
  },
  "DELETE /api/auth/session 200": {
    authenticated: false,
    message: "Session revoked"
  },
  "GET /api/auth/challenge 200": {
    challenge: "chl_98234ab1c09d8e7f",
    message: "Sign this message to authenticate with OphirPay: chl_98234ab1c09d8e7f",
    expiresIn: 300
  },
  "GET /api/csrf 200": {
    success: true,
    data: {
      csrfToken: "csrf_019a88f24bc910ae",
      headerName: "x-csrf-token"
    }
  },
  "GET /api/multisig 200": {
    success: true,
    data: {
      threshold: 2,
      signers: [
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2"
      ],
      enabled: true
    }
  },
  "POST /api/multisig 201": {
    success: true,
    data: {
      threshold: 2,
      signers: [
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "GCKIK6UJJ5GDRV47Z2P3N2V376P5Y4G6Z66N2BJZP3M2M2N2M2N2M2N2"
      ],
      enabled: true
    }
  },
  "POST /api/multisig/propose 201": {
    success: true,
    data: {
      proposalId: 1,
      requiredSignatures: 2,
      currentSignatures: 1,
      status: "PENDING_APPROVAL",
      proposer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      createdAt: "2026-08-26T19:00:00.000Z"
    }
  },
  "POST /api/multisig/approve 200": {
    success: true,
    data: {
      requestId: 1,
      approvals: 2,
      threshold: 2,
      readyToExecute: true
    }
  },
  "POST /api/multisig/execute 200": {
    success: true,
    data: {
      requestId: 1,
      status: "EXECUTED",
      transactionHash: "8f33190e21a8b94ec174591a2bc0d8e12a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d"
    }
  },
  "GET /api/multisig/requests 200": {
    success: true,
    data: [
      {
        requestId: 1,
        payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        amount: 1000.0,
        assetCode: "USDC",
        approvals: 1,
        threshold: 2,
        executed: false
      }
    ]
  },
  "GET /api/governance/proposals 200": {
    success: true,
    data: {
      items: [
        {
          id: 1,
          title: "Reduce Base Fee to 10 BPS",
          description: "Proposal to decrease base transfer fee across all payments",
          action_type: "update_fee",
          yes_votes: 120000,
          no_votes: 5000,
          voting_ends_at: 1725300000,
          executed: false,
          proposer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        }
      ],
      total: 1,
      truncated: false
    }
  },
  "POST /api/governance/proposals 201": {
    success: true,
    data: {
      proposalId: 1,
      title: "Reduce Base Fee to 10 BPS",
      status: "ACTIVE",
      votingEndsAt: 1725300000,
      createdAt: "2026-08-26T19:00:00.000Z"
    }
  },
  "POST /api/governance/vote 200": {
    success: true,
    data: {
      proposalId: 1,
      voter: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      support: true,
      votingPower: 50000
    }
  },
  "POST /api/governance/execute 200": {
    success: true,
    data: {
      proposalId: 1,
      status: "EXECUTED",
      transactionHash: "8f33190e21a8b94ec174591a2bc0d8e12a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d"
    }
  },
  "GET /api/analytics 200": {
    success: true,
    data: {
      totalPayments: 3840,
      completedPayments: 3834,
      failedPayments: 6,
      totalVolume: 1428500.0,
      averageAmount: 372.0,
      successRate: 99,
      volumeByDay: [
        {
          date: "2026-08-26",
          volume: 48200.0,
          count: 120
        }
      ]
    }
  },
  "GET /api/refunds 200": {
    success: true,
    data: [
      {
        id: "ref_001948ba",
        paymentId: 1024,
        onChainId: 12,
        amount: 250.0,
        asset: "USDC",
        reason: "Product damaged in shipping",
        reasonCode: 1,
        status: "COMPLETED",
        createdAt: "2026-08-26T19:00:00.000Z"
      }
    ]
  },
  "POST /api/refunds 201": {
    success: true,
    data: {
      id: "ref_001948ba",
      paymentId: 1024,
      onChainId: 12,
      amount: 2500000000,
      asset: "USDC",
      reason: "Product damaged in shipping",
      reasonCode: 1,
      status: "REQUESTED",
      createdAt: "2026-08-26T19:00:00.000Z"
    }
  },
  "PATCH /api/refunds/{id} 200": {
    success: true,
    data: {
      id: "ref_001948ba",
      status: "APPROVED",
      updatedAt: "2026-08-26T19:15:00.000Z"
    }
  },
  "GET /api/hooks 200": {
    success: true,
    data: [
      {
        id: "hk_019a88bc",
        eventType: "payment.completed",
        webhookUrl: "https://backend.example.com/api/hooks",
        onChainId: 4,
        active: true,
        createdAt: "2026-08-26T19:00:00.000Z"
      }
    ]
  },
  "POST /api/hooks 201": {
    success: true,
    data: {
      id: "hk_019a88bc",
      eventType: "payment.completed",
      webhookUrl: "https://backend.example.com/api/hooks",
      onChainId: 4,
      active: true,
      createdAt: "2026-08-26T19:00:00.000Z"
    }
  },
  "PATCH /api/hooks/{id} 200": {
    success: true,
    data: {
      id: "hk_019a88bc",
      active: false,
      updatedAt: "2026-08-26T19:20:00.000Z"
    }
  },
  "GET /api/audit-log 200": {
    success: true,
    data: [
      {
        id: "audit_88194a",
        actor: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        action: "ESCROW_CREATED",
        target: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        timestamp: "2026-08-26T19:00:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 10,
      total: 1
    }
  },
  "GET /api/audit-log/sse 200": 'data: {"id":"audit_88194a","action":"ESCROW_CREATED","timestamp":"2026-08-26T19:00:00.000Z"}\n\n',
  "GET /api/audit-log/export 200": "id,actor,action,target,timestamp\naudit_88194a,GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,ESCROW_CREATED,CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC,2026-08-26T19:00:00.000Z",
  "GET /api/events 200": 'data: {"type":"payment.completed","id":"pay_98234ab1c09d","amount":150.00,"timestamp":"2026-08-26T18:15:04.000Z"}\n\n',
  "GET /api/events/history 200": {
    success: true,
    data: [
      {
        type: "payment.completed",
        id: "pay_98234ab1c09d",
        timestamp: "2026-08-26T18:15:04.000Z"
      }
    ]
  },
  "GET /api/health 200": {
    success: true,
    data: {
      status: "ok",
      version: "0.1.0",
      services: {
        database: { status: "ok", latencyMs: 12 },
        redis: { status: "ok", latencyMs: 3 },
        stellar: {
          network: "testnet",
          rpcUrl: "https://soroban-testnet.stellar.org",
          horizonUrl: "https://horizon-testnet.stellar.org",
          rpc: { status: "ok", latencyMs: 45 },
          horizon: { status: "ok", latencyMs: 38 }
        },
        contract: {
          id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          status: "ok"
        }
      },
      uptime: 12450.5
    },
    meta: {
      timestamp: "2026-08-26T19:10:00.000Z"
    }
  },
  "GET /api/metrics 200": "# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method=\"GET\",path=\"/api/health\",status=\"200\"} 1420",
  "GET /api/cron 200": {
    success: true,
    data: {
      picked: 2,
      executed: 2,
      failed: 0,
      skipped: 0,
      timestamp: "2026-08-26T19:00:00.000Z"
    }
  },
  "POST /api/cron 200": {
    success: true,
    data: {
      picked: 2,
      executed: 2,
      failed: 0,
      skipped: 0,
      timestamp: "2026-08-26T19:00:00.000Z"
    }
  },
  "POST /api/jobs/process-due-recurring 200": {
    success: true,
    data: {
      processed: 5,
      succeeded: 5,
      failed: 0,
      timestamp: "2026-08-26T19:00:00.000Z"
    }
  },
  "GET /api/pause-state 200": {
    success: true,
    data: {
      paused: false,
      available: true
    }
  }
};

// Now let us load the parsed spec using js-yaml to manipulate object cleanly.
const spec = yaml.load(content);

// 1. Add requestBody examples
const dataMethods = ["get", "post", "put", "patch", "delete"];
for (const [p, item] of Object.entries(spec.paths)) {
  for (const [m, op] of Object.entries(item)) {
    if (!dataMethods.includes(m)) continue;
    const key = `${m.toUpperCase()} ${p}`;
    if (op.requestBody) {
      const ex = REQUEST_EXAMPLES[key];
      if (!ex) {
        console.error("Missing request example for:", key);
      } else {
        if (!op.requestBody.content) {
          op.requestBody.content = { "application/json": {} };
        }
        if (!op.requestBody.content["application/json"]) {
          op.requestBody.content["application/json"] = {};
        }
        op.requestBody.content["application/json"].example = ex;
      }
    }

    // 2. Add primary success response example
    const sc = Object.keys(op.responses || {}).find(c => /^2\d\d$/.test(c) || c === "default");
    if (!sc) {
      console.error("No success response for:", key);
      continue;
    }

    // Check if there are multiple success codes (e.g. 200 and 201)
    const successCodes = Object.keys(op.responses || {}).filter(c => /^2\d\d$/.test(c) || c === "default");
    for (const code of successCodes) {
      const respKey = `${key} ${code}`;
      const respEx = RESPONSE_EXAMPLES[respKey];
      if (!respEx) {
        console.error("Missing response example for:", respKey);
        continue;
      }

      const resp = op.responses[code];
      const isCsv = key === "GET /api/payments/export" || key === "GET /api/audit-log/export";
      const isSse = key === "GET /api/audit-log/sse" || key === "GET /api/events";
      const isText = key === "GET /api/metrics";

      const mediaType = isCsv ? "text/csv" : isSse ? "text/event-stream" : isText ? "text/plain" : "application/json";

      if (!resp.content) resp.content = {};
      if (!resp.content[mediaType]) resp.content[mediaType] = {};
      resp.content[mediaType].example = respEx;
    }
  }
}

// 3. Update components.responses
const ERROR_RESPONSES = {
  ValidationError: {
    description: "Invalid request data (code: VALIDATION_ERROR)",
    code: "VALIDATION_ERROR",
    message: "Invalid request payload: destination address is required"
  },
  NotFound: {
    description: "Resource not found (code: NOT_FOUND)",
    code: "NOT_FOUND",
    message: "Requested resource was not found"
  },
  Unauthorized: {
    description: "Missing or invalid API key (code: UNAUTHORIZED)",
    code: "UNAUTHORIZED",
    message: "Authentication required. Missing or invalid API key."
  },
  Forbidden: {
    description: "Insufficient permissions (code: FORBIDDEN)",
    code: "FORBIDDEN",
    message: "Insufficient permissions to perform this action"
  },
  Conflict: {
    description: "Resource state conflict (code: CONFLICT)",
    code: "CONFLICT",
    message: "Resource already exists or conflicting state transition"
  },
  RateLimited: {
    description: "Too many requests (code: RATE_LIMITED)",
    code: "RATE_LIMITED",
    message: "Rate limit exceeded. Please back off before retrying."
  },
  ServerError: {
    description: "Internal server error (code: INTERNAL_ERROR)",
    code: "INTERNAL_ERROR",
    message: "An internal server error occurred"
  },
  ServiceUnavailable: {
    description: "Service temporarily unavailable (code: SERVICE_UNAVAILABLE)",
    code: "SERVICE_UNAVAILABLE",
    message: "Service or critical dependency temporarily unavailable"
  }
};

for (const [name, info] of Object.entries(ERROR_RESPONSES)) {
  if (spec.components.responses[name]) {
    spec.components.responses[name].description = info.description;
    spec.components.responses[name].content = {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/ErrorResponse"
        },
        example: {
          success: false,
          error: {
            code: info.code,
            message: info.message
          }
        }
      }
    };
  }
}

// 4. Update the 13 direct error responses:
if (spec.paths["/api/payments/retry"]?.post?.responses?.["409"]) {
  spec.paths["/api/payments/retry"].post.responses["409"] = {
    description: "Payment is not in a retryable (FAILED) state (code: STATE_CONFLICT)",
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/ErrorResponse"
        },
        example: {
          success: false,
          error: {
            code: "STATE_CONFLICT",
            message: "Payment is not in a retryable (FAILED) state"
          }
        }
      }
    }
  };
}

if (spec.paths["/api/recurring"]?.patch?.responses?.["404"]) {
  spec.paths["/api/recurring"].patch.responses["404"] = {
    $ref: "#/components/responses/NotFound"
  };
}

if (spec.paths["/api/scheduled/run"]?.get?.responses?.["503"]) {
  spec.paths["/api/scheduled/run"].get.responses["503"] = {
    $ref: "#/components/responses/ServiceUnavailable"
  };
}

if (spec.paths["/api/scheduled/run"]?.post?.responses?.["503"]) {
  spec.paths["/api/scheduled/run"].post.responses["503"] = {
    $ref: "#/components/responses/ServiceUnavailable"
  };
}

if (spec.paths["/api/webhooks"]?.patch?.responses?.["400"]) {
  spec.paths["/api/webhooks"].patch.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/webhooks"]?.delete?.responses?.["400"]) {
  spec.paths["/api/webhooks"].delete.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/keys"]?.patch?.responses?.["400"]) {
  spec.paths["/api/keys"].patch.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/keys"]?.delete?.responses?.["400"]) {
  spec.paths["/api/keys"].delete.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/keys/stats"]?.get?.responses?.["400"]) {
  spec.paths["/api/keys/stats"].get.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/auth/challenge"]?.get?.responses?.["400"]) {
  spec.paths["/api/auth/challenge"].get.responses["400"] = {
    $ref: "#/components/responses/ValidationError"
  };
}

if (spec.paths["/api/cron"]?.get?.responses?.["503"]) {
  spec.paths["/api/cron"].get.responses["503"] = {
    $ref: "#/components/responses/ServiceUnavailable"
  };
}

if (spec.paths["/api/cron"]?.post?.responses?.["503"]) {
  spec.paths["/api/cron"].post.responses["503"] = {
    $ref: "#/components/responses/ServiceUnavailable"
  };
}

if (spec.paths["/api/health"]?.get?.responses?.["503"]) {
  spec.paths["/api/health"].get.responses["503"] = {
    description: "Critical dependency unavailable (code: SERVICE_UNAVAILABLE)",
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/ErrorResponse"
        },
        example: {
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Critical dependency (database) unavailable"
          }
        }
      }
    }
  };
}

// Dump spec
const newYaml = yaml.dump(spec, {
  noRefs: true,
  lineWidth: -1,
  quotingType: '"'
});

fs.writeFileSync(SPEC_PATH, newYaml);
console.log("Successfully updated docs/openapi.yaml with examples!");
