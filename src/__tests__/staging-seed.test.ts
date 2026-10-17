import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertSafeDatabaseUrl,
  sanitizeEmail,
  sanitizeApiKey,
  generateMockStellarKey,
  parseSeedOptions,
  runSeed,
} from "../../prisma/seed";
import type { PrismaClient } from "@prisma/client";

interface MockPaymentRecord {
  metadata?: string;
  [key: string]: unknown;
}

describe("staging-seed (Issue #1423)", () => {
  describe("parseSeedOptions", () => {
    it("defaults to minimal profile when no arguments or env vars are supplied", () => {
      const options = parseSeedOptions([], {});
      expect(options.profile).toBe("minimal");
      expect(options.sanitize).toBe(false);
      expect(options.dryRun).toBe(false);
    });

    it("parses --profile=staging and flags correctly", () => {
      const options = parseSeedOptions(["--profile=staging", "--sanitize"], {});
      expect(options.profile).toBe("staging");
      expect(options.sanitize).toBe(true);
    });

    it("parses -p staging flag correctly", () => {
      const options = parseSeedOptions(["-p", "staging"], {});
      expect(options.profile).toBe("staging");
    });

    it("parses standalone shortcut flags --staging, --minimal, --load", () => {
      expect(parseSeedOptions(["--staging"], {}).profile).toBe("staging");
      expect(parseSeedOptions(["--minimal"], {}).profile).toBe("minimal");
      expect(parseSeedOptions(["--load"], {}).profile).toBe("load");
    });

    it("respects SEED_PROFILE and SEED_SANITIZE environment variables", () => {
      const options = parseSeedOptions([], {
        SEED_PROFILE: "staging",
        SEED_SANITIZE: "true",
      });
      expect(options.profile).toBe("staging");
      expect(options.sanitize).toBe(true);
    });

    it("parses --dry-run flag", () => {
      const options = parseSeedOptions(["--profile=staging", "--dry-run"], {});
      expect(options.dryRun).toBe(true);
    });
  });

  describe("assertSafeDatabaseUrl (Production Guardrails)", () => {
    it("allows non-production dev and staging database URLs", () => {
      expect(() =>
        assertSafeDatabaseUrl("file:./dev.db", { NODE_ENV: "development" })
      ).not.toThrow();

      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://user:pass@ep-staging-pooler.us-east-2.aws.neon.tech/neondb",
          { NODE_ENV: "development", STELLAR_NETWORK: "TESTNET" }
        )
      ).not.toThrow();

      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://postgres:postgres@localhost:5432/ophirpay_test",
          { NODE_ENV: "test" }
        )
      ).not.toThrow();
    });

    it("throws when NODE_ENV or VERCEL_ENV is set to production", () => {
      expect(() =>
        assertSafeDatabaseUrl("file:./dev.db", { NODE_ENV: "production" })
      ).toThrow(/SAFETY CHECK/);

      expect(() =>
        assertSafeDatabaseUrl("file:./dev.db", { VERCEL_ENV: "production" })
      ).toThrow(/SAFETY CHECK/);
    });

    it("throws when STELLAR_NETWORK is set to PUBLIC or MAINNET", () => {
      expect(() =>
        assertSafeDatabaseUrl("file:./dev.db", {
          NODE_ENV: "development",
          STELLAR_NETWORK: "PUBLIC",
        })
      ).toThrow(/SAFETY CHECK/);

      expect(() =>
        assertSafeDatabaseUrl("file:./dev.db", {
          NODE_ENV: "development",
          NEXT_PUBLIC_STELLAR_NETWORK: "MAINNET",
        })
      ).toThrow(/SAFETY CHECK/);
    });

    it("throws when DATABASE_URL matches production host or database name patterns", () => {
      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://admin:secret@ep-prod-db-pooler.us-east-2.aws.neon.tech/neondb",
          { NODE_ENV: "development" }
        )
      ).toThrow(/SAFETY CHECK/);

      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://admin:secret@db.production.aws.com/ophirpay",
          { NODE_ENV: "development" }
        )
      ).toThrow(/SAFETY CHECK/);

      expect(() =>
        assertSafeDatabaseUrl(
          "postgresql://admin:secret@localhost:5432/ophirpay_prod",
          { NODE_ENV: "development" }
        )
      ).toThrow(/SAFETY CHECK/);
    });
  });

  describe("sanitizeEmail & sanitizeApiKey", () => {
    it("converts real email addresses into deterministic staging addresses", () => {
      const sanitized1 = sanitizeEmail("founder@external-company.com");
      const sanitized2 = sanitizeEmail("founder@external-company.com");
      expect(sanitized1).toBe(sanitized2);
      expect(sanitized1).toMatch(/^user_[a-f0-9]{10}@staging\.ophirpay\.internal$/);
    });

    it("leaves already-sanitized staging email addresses unchanged", () => {
      const alreadySafe = "merchant@staging.ophirpay.internal";
      expect(sanitizeEmail(alreadySafe)).toBe(alreadySafe);
    });

    it("generates safe API key prefix oph_stg_ and v1: sha256 hash", () => {
      const { prefix, keyHash } = sanitizeApiKey("my-secret-key-12345");
      expect(prefix.startsWith("oph_stg_")).toBe(true);
      expect(keyHash.startsWith("v1:")).toBe(true);
      expect(keyHash.length).toBe(3 + 64);
    });
  });

  describe("generateMockStellarKey", () => {
    it("returns valid 56-character Stellar public keys starting with G", () => {
      for (let i = 0; i < 5; i++) {
        const key = generateMockStellarKey(i);
        expect(key).toHaveLength(56);
        expect(key.startsWith("G")).toBe(true);
      }
    });
  });

  describe("runSeed integration workflow", () => {
    let mockPrisma: PrismaClient;

    beforeEach(() => {
      mockPrisma = {
        user: {
          upsert: vi.fn().mockImplementation(({ create, update }) => Promise.resolve(create || update)),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
        },
        account: {
          upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: "acc_" + Math.random(), ...create })),
        },
        batch: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "batch_" + Math.random(), ...data })),
        },
        payment: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "pay_" + Math.random(), ...data })),
        },
        recurrence: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "rec_" + Math.random(), ...data })),
        },
        scheduledPayment: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "sch_" + Math.random(), ...data })),
        },
        paymentRequest: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "req_" + Math.random(), ...data })),
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
        },
        refund: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ref_" + Math.random(), ...data })),
        },
        webhook: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "wh_" + Math.random(), ...data })),
        },
        webhookEvent: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "whe_" + Math.random(), ...data })),
        },
        webhookDelivery: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "whd_" + Math.random(), ...data })),
        },
        auditLog: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "aud_" + Math.random(), ...data })),
        },
        notificationHook: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "nh_" + Math.random(), ...data })),
        },
        apiKey: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "key_" + Math.random(), ...data })),
        },
        apiKeyRequestLog: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "klog_" + Math.random(), ...data })),
        },
        paymentSyncRun: {
          create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "psr_" + Math.random(), ...data })),
        },
      } as unknown as PrismaClient;
    });

    it("runs minimal seed profile", async () => {
      const summary = await runSeed(mockPrisma, { profile: "minimal", sanitize: false, dryRun: false });
      expect(summary.profile).toBe("minimal");
      expect(summary.usersCount).toBe(1);
      expect(summary.paymentsCount).toBe(5);
      expect(summary.batchesCount).toBe(1);
      expect(summary.refundsCount).toBe(4);
      expect(summary.hooksCount).toBe(3);
    });

    it("runs staging seed profile with full entity coverage and business scenarios", async () => {
      const summary = await runSeed(mockPrisma, { profile: "staging", sanitize: false, dryRun: false });

      expect(summary.profile).toBe("staging");
      expect(summary.usersCount).toBe(4);
      expect(summary.accountsCount).toBe(5);
      expect(summary.batchesCount).toBe(2);
      expect(summary.paymentsCount).toBeGreaterThanOrEqual(10);
      expect(summary.recurrencesCount).toBe(2);
      expect(summary.scheduledPaymentsCount).toBe(2);
      expect(summary.paymentRequestsCount).toBe(2);
      expect(summary.refundsCount).toBe(2);
      expect(summary.webhooksCount).toBe(1);
      expect(summary.webhookEventsCount).toBe(1);
      expect(summary.webhookDeliveriesCount).toBe(1);
      expect(summary.auditLogsCount).toBe(3);
      expect(summary.hooksCount).toBe(3);
      expect(summary.apiKeysCount).toBe(1);
      expect(summary.apiKeyLogsCount).toBe(1);
      expect(summary.syncRunsCount).toBe(1);

      // Verify business scenario payloads in payment creation calls:
      const paymentMock = mockPrisma.payment.create as unknown as {
        mock: { calls: Array<[{ data: MockPaymentRecord }]> };
      };
      const paymentCalls = paymentMock.mock.calls.map((c) => c[0].data);

      // 1. Active Escrow
      const escrowPayment = paymentCalls.find(
        (p) => p.metadata && (JSON.parse(p.metadata) as { type?: string }).type === "escrow"
      );
      expect(escrowPayment).toBeDefined();
      const escrowMeta = JSON.parse(escrowPayment?.metadata || "{}");
      expect(escrowMeta.state).toBe("ACTIVE");
      expect(escrowMeta.escrowId).toBe("esc_stg_101");
      expect(escrowMeta.arbiter.startsWith("G")).toBe(true);

      // 2. Partially Vested Stream
      const streamPayment = paymentCalls.find(
        (p) => p.metadata && (JSON.parse(p.metadata) as { type?: string }).type === "stream"
      );
      expect(streamPayment).toBeDefined();
      const streamMeta = JSON.parse(streamPayment?.metadata || "{}");
      expect(streamMeta.state).toBe("ACTIVE");
      expect(streamMeta.vestedAmount).toBe("5600.0000000");
      expect(streamMeta.cliffPassed).toBe(true);

      // 3. Multi-Signature Approval Queue
      const multisigPayment = paymentCalls.find(
        (p) => p.metadata && (JSON.parse(p.metadata) as { type?: string }).type === "multisig"
      );
      expect(multisigPayment).toBeDefined();
      const multisigMeta = JSON.parse(multisigPayment?.metadata || "{}");
      expect(multisigMeta.proposalId).toBe("prop_stg_303");
      expect(multisigMeta.threshold).toBe(2);
      expect(multisigMeta.pendingApproval).toBe(true);
    });

    it("supports dryRun without executing database writes", async () => {
      const summary = await runSeed(mockPrisma, { profile: "staging", sanitize: false, dryRun: true });
      expect(summary.usersCount).toBe(0);
      expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
