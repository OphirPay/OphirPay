// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  isDemoMode,
  generateDemoTxHash,
  simulatePayment,
  simulateBatchPayment,
  DEMO_WALLET,
  DEMO_PAYMENTS,
  DEMO_EVENTS,
  DEMO_MULTISIG,
  DEMO_PROPOSALS,
} from "@/lib/demo-mode";

const ROOT = process.cwd();
const DOC_PATH = path.join(ROOT, "docs/DEMO_MODE.md");

describe("Demo Mode Documentation & Helpers (Issue #777)", () => {
  it("docs/DEMO_MODE.md exists and is non-empty", () => {
    expect(fs.existsSync(DOC_PATH)).toBe(true);
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("documents the behavioral effects of NEXT_PUBLIC_DEMO_MODE", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("NEXT_PUBLIC_DEMO_MODE");
    expect(content).toContain("isDemoMode");
    expect(content).toContain("simulatePayment");
    expect(content).toContain("simulateBatchPayment");
    expect(content).toContain("DEMO_WALLET");
  });

  it("explicitly states Mainnet prohibition and security safeguards", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("Mainnet Prohibition");
    expect(content).toContain("NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC");
    expect(content).toContain("API Integrity Preserved");
    expect(content).toContain("verifyCsrf");
    expect(content).toContain("getAuthContext");
  });

  it("documents seeding, teardown, and smoke testing procedures", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("scripts/demo-seed.sh");
    expect(content).toContain("prisma/seed.ts");
    expect(content).toContain("scripts/demo-test.sh");
    expect(content).toContain("Teardown & Environment Reset");
    expect(content).toContain("prisma/dev.db");
    expect(content).toContain("prisma migrate reset");
  });

  it("documents screenshot and video asset capture workflows", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("scripts/capture-screenshots.js");
    expect(content).toContain("scripts/capture-mockups.js");
    expect(content).toContain("public/demo.mp4");
    expect(content).toContain("1920x1080");
  });

  it("catalogs non-sensitive demo credentials and public keys", () => {
    const content = fs.readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO");
    expect(content).toContain("GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U");
    expect(content).toContain("seed-user-1");
  });

  it("verifies referenced scripts exist on disk", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts/demo-seed.sh"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "scripts/demo-test.sh"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "scripts/capture-screenshots.js"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "scripts/capture-mockups.js"))).toBe(true);
  });

  it("verifies demo-mode.ts helpers function accurately", () => {
    expect(typeof isDemoMode()).toBe("boolean");

    const hash = generateDemoTxHash("pay");
    expect(hash).toMatch(/^pay_/);

    const payment = simulatePayment({ payee: "GTESTPAYEE", amount: "50" });
    expect(payment.status).toBe("RECORDED");
    expect(payment.demo).toBe(true);
    expect(payment.payee).toBe("GTESTPAYEE");
    expect(payment.amount).toBe("50");

    const batch = simulateBatchPayment({
      payees: ["G1", "G2"],
      amounts: ["10", "20"],
    });
    expect(batch).toHaveLength(2);
    expect(batch[0].payee).toBe("G1");
    expect(batch[1].payee).toBe("G2");

    expect(DEMO_WALLET.publicKey).toBe(
      "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO"
    );
    expect(DEMO_WALLET.network).toBe("TESTNET");
    expect(DEMO_PAYMENTS.length).toBeGreaterThan(0);
    expect(DEMO_EVENTS.length).toBeGreaterThan(0);
    expect(DEMO_MULTISIG.signers.length).toBe(3);
    expect(DEMO_PROPOSALS.length).toBe(2);
  });
});
