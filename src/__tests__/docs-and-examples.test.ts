// SPDX-License-Identifier: MIT

import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";

import { xdr } from "@stellar/stellar-sdk";
import { describe, expect,it } from "vitest";

import { decodeSorobanEvent } from "../../examples/subscribe-events";

const root = process.cwd();

describe("Documentation Verification", () => {
  describe("Prisma Migration & CI Guide (Issue #2007)", () => {
    const docPath = join(root, "docs", "PRISMA-CI.md");

    it("exists and has substantial content", () => {
      expect(existsSync(docPath)).toBe(true);
      const content = readFileSync(docPath, "utf8");
      expect(content.length).toBeGreaterThan(1000);
    });

    it("documents differences between prisma migrate dev and prisma migrate deploy", () => {
      const content = readFileSync(docPath, "utf8");
      expect(content).toContain("prisma migrate dev");
      expect(content).toContain("prisma migrate deploy");
      expect(content).toContain("Shadow Database");
      expect(content).toContain("Local development only");
      expect(content).toContain("CI/CD, Staging, Production");
    });

    it("documents baseline migration procedures for fresh and pre-existing databases", () => {
      const content = readFileSync(docPath, "utf8");
      expect(content).toContain("Greenfield");
      expect(content).toContain("Baselining Pre-Existing Databases");
      expect(content).toContain("prisma migrate resolve --applied");
      expect(content).toContain("npm run db:seed");
    });

    it("documents rollback and disaster recovery workflows", () => {
      const content = readFileSync(docPath, "utf8");
      expect(content).toContain("Rollback");
      expect(content).toContain("forward-only");
      expect(content).toContain("prisma migrate resolve --rolled-back");
      expect(content).toContain("prisma migrate status");
      expect(content).toContain("Point-in-Time Recovery");
      expect(content).toContain("pg_dump");
    });

    it("documents breaking schema changes and zero-downtime expand-and-contract patterns", () => {
      const content = readFileSync(docPath, "utf8");
      expect(content).toContain("Breaking Schema Changes");
      expect(content).toContain("Expand and Contract");
      expect(content).toContain("NOT NULL");
      expect(content).toContain("Renaming a Column");
      expect(content).toContain("@db.Decimal(18, 7)");
    });
  });

  describe("Helm Chart Guide (Issue #2008)", () => {
    const helmReadmePath = join(root, "helm", "README.md");

    it("exists and has substantial content", () => {
      expect(existsSync(helmReadmePath)).toBe(true);
      const content = readFileSync(helmReadmePath, "utf8");
      expect(content.length).toBeGreaterThan(1000);
    });

    it("documents core Helm values and configuration parameters", () => {
      const content = readFileSync(helmReadmePath, "utf8");
      expect(content).toContain("replicaCount");
      expect(content).toContain("existingSecret");
      expect(content).toContain("DATABASE_URL");
      expect(content).toContain("AUTH_SECRET");
      expect(content).toContain("ingress");
      expect(content).toContain("autoscaling");
      expect(content).toContain("livenessProbe");
      expect(content).toContain("readinessProbe");
      expect(content).toContain("migrations");
    });

    it("explains secrets management patterns (existingSecret vs direct values)", () => {
      const content = readFileSync(helmReadmePath, "utf8");
      expect(content).toContain("secrets.existingSecret");
      expect(content).toContain("External Secret");
      expect(content).toContain("Direct Helm Values");
    });

    it("provides deployment commands for local and cloud clusters", () => {
      const content = readFileSync(helmReadmePath, "utf8");
      expect(content).toContain("minikube");
      expect(content).toContain("helm upgrade --install");
      expect(content).toContain("helm rollback");
    });
  });

  describe("API Rate Limiting & Tier Quotas Guide (Issue #2009)", () => {
    const rateLimitDocPath = join(root, "docs", "api", "rate-limiting.md");

    it("exists and has substantial content", () => {
      expect(existsSync(rateLimitDocPath)).toBe(true);
      const content = readFileSync(rateLimitDocPath, "utf8");
      expect(content.length).toBeGreaterThan(1000);
    });

    it("documents standard rate-limiting HTTP headers", () => {
      const content = readFileSync(rateLimitDocPath, "utf8");
      expect(content).toContain("X-RateLimit-Limit");
      expect(content).toContain("X-RateLimit-Remaining");
      expect(content).toContain("X-RateLimit-Reset");
      expect(content).toContain("Retry-After");
      expect(content).toContain("X-Request-Id");
    });

    it("documents all four rate-limiting tiers and quotas", () => {
      const content = readFileSync(rateLimitDocPath, "utf8");
      expect(content).toContain("Global Proxy Tier");
      expect(content).toContain("RATE_LIMIT_RPM");
      expect(content).toContain("Wallet Authentication Tier");
      expect(content).toContain("AUTH_RATE_LIMIT_IP_RPM");
      expect(content).toContain("AUTH_RATE_LIMIT_WALLET_RPM");
      expect(content).toContain("Address & Wallet Lookup Tier");
      expect(content).toContain("LOOKUP_RATE_LIMIT_IP_RPM");
      expect(content).toContain("LOOKUP_RATE_LIMIT_ADDR_RPM");
      expect(content).toContain("API Key Lifecycle Tier");
      expect(content).toContain("MAX_API_KEY_MUTATIONS_PER_HOUR");
      expect(content).toContain("MAX_ACTIVE_API_KEYS");
    });

    it("documents HTTP 429 response structure and retry/backoff code example", () => {
      const content = readFileSync(rateLimitDocPath, "utf8");
      expect(content).toContain("429 Too Many Requests");
      expect(content).toContain("RATE_LIMITED");
      expect(content).toContain("fetchWithRateLimitRetry");
      expect(content).toContain("Retry-After");
    });
  });

  describe("Soroban RPC Event Subscription Example (Issue #2010)", () => {
    const examplePath = join(root, "examples", "subscribe-events.ts");
    const sseDocPath = join(root, "docs", "CONTRACT_SSE_REFERENCE.md");

    it("example script exists and is cross-referenced in documentation", () => {
      expect(existsSync(examplePath)).toBe(true);
      const sseContent = readFileSync(sseDocPath, "utf8");
      expect(sseContent).toContain("examples/subscribe-events.ts");
      expect(sseContent).toContain("getEvents");
    });

    it("decodeSorobanEvent correctly decodes mock Soroban events", () => {
      const topicSymbol = xdr.ScVal.scvSymbol("payment_event");
      const payerAddress = xdr.ScVal.scvString("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
      const payeeAddress = xdr.ScVal.scvString("GB6NV2AA5UV67K5KBOVPYZBXOEAWETDBGZO2FS6KF5OHUKGLYBD45WPT");

      // value: tuple of (amount, tx_hash)
      const amountVal = xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString("500000000"), hi: xdr.Int64.fromString("0") }));
      const txHashVal = xdr.ScVal.scvString("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
      const valVec = xdr.ScVal.scvVec([amountVal, txHashVal]);

      const mockRawEvent = {
        id: "0000000000000001-0000000001",
        type: "contract",
        ledger: 100500,
        ledgerClosedAt: "2026-11-18T16:00:00Z",
        contractId: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
        topic: [topicSymbol, payerAddress, payeeAddress],
        value: valVec,
        inSuccessfulContractCall: true,
        pagingToken: "100500-1",
      };

      const decoded = decodeSorobanEvent(
        mockRawEvent as unknown as Parameters<typeof decodeSorobanEvent>[0]
      );
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe("0000000000000001-0000000001");
      expect(decoded?.ledger).toBe(100500);
      expect(decoded?.topic).toBe("payment_event");
      expect(decoded?.payer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
      expect(decoded?.payee).toBe("GB6NV2AA5UV67K5KBOVPYZBXOEAWETDBGZO2FS6KF5OHUKGLYBD45WPT");
      expect(decoded?.amount).toBe("500000000");
      expect(decoded?.txHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  });
});
