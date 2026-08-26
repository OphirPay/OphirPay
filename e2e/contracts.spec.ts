// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

// ── WASM Artifact Verification ─────────────────────────────────
// NOTE: In CI these files are provided by the `contract-wasm` job
// via the `contract-wasm` artifact (see .github/workflows/ci.yml).

test.describe("Contract WASM Artifacts", () => {
  test("OphirPay WASM exists and is non-empty", () => {
    const wasmPath = join(
      __dirname,
      "..",
      "contracts",
      "ophirpay",
      "target",
      "wasm32v1-none",
      "release",
      "ophirpay_contract.wasm"
    );
    expect(existsSync(wasmPath)).toBe(true);

    const wasm = readFileSync(wasmPath);
    expect(wasm.length).toBeGreaterThan(1000);
    // WASM magic bytes: 0x00 0x61 0x73 0x6d ("\0asm")
    expect(wasm[0]).toBe(0x00);
    expect(wasm[1]).toBe(0x61);
    expect(wasm[2]).toBe(0x73);
    expect(wasm[3]).toBe(0x6d);
    console.log(`OphirPay WASM: ${wasm.length} bytes`);
  });

  test("Emitter WASM exists and is non-empty", () => {
    const wasmPath = join(
      __dirname,
      "..",
      "contracts",
      "emitter",
      "target",
      "wasm32v1-none",
      "release",
      "ophirpay_emitter.wasm"
    );
    expect(existsSync(wasmPath)).toBe(true);

    const wasm = readFileSync(wasmPath);
    expect(wasm.length).toBeGreaterThan(500);
    expect(wasm[0]).toBe(0x00);
    expect(wasm[1]).toBe(0x61);
    expect(wasm[2]).toBe(0x73);
    expect(wasm[3]).toBe(0x6d);
    console.log(`Emitter WASM: ${wasm.length} bytes`);
  });

  test("OphirPay WASM is within size budget (< 100 KB)", () => {
    const wasmPath = join(
      __dirname,
      "..",
      "contracts",
      "ophirpay",
      "target",
      "wasm32v1-none",
      "release",
      "ophirpay_contract.wasm"
    );
    const wasm = readFileSync(wasmPath);
    // Soroban mainnet upload limit is ~128 KB; we budget 100 KB
    expect(wasm.length).toBeLessThan(100 * 1024);
  });
});

// ── Contract API Integration (requires Testnet deployment) ─────

test.describe("Contract Operations via API", () => {
  // These tests assume the contracts are deployed and the API
  // is configured with valid NEXT_PUBLIC_CONTRACT_ID and
  // NEXT_PUBLIC_EMITTER_CONTRACT_ID pointing to Testnet.
  // Data routes are auth-gated → 401 without a session/API key.

  test("GET /api/health reports Stellar RPC connectivity", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    // 200 when healthy; 503 when a dependency (e.g. DB) is degraded —
    // either way the Stellar service info is reported in the body.
    expect([200, 503]).toContain(res.status());

    const json = await res.json();
    // The Stellar service check should report network info
    expect(json.data.services.stellar).toBeDefined();
    console.log(
      `Stellar network: ${json.data.services.stellar.network || "unknown"}`
    );
  });

  test("GET /api/payments returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/payments?page=1&limit=5`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/escrows returns 401 without auth", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/escrows`, {
      data: { beneficiary: "GXXX", amount: "100" },
    });
    // Auth check runs before validation, so an unauthenticated request
    // with missing fields still returns 401 (not 400).
    expect(res.status()).toBe(401);
  });

  test("GET /api/stats returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/stats`);
    expect(res.status()).toBe(401);
  });

  test("GET /api/fee-config returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/fee-config`);
    expect(res.status()).toBe(401);
  });
});

// ── Escrow Lifecycle (end-to-end, requires Testnet + auth) ─────

test.describe("Escrow Lifecycle E2E", () => {
  test("full escrow flow requires authentication", async ({ request }) => {
    // Without a session/API key the whole flow is blocked at the auth gate.
    const createRes = await request.post(`${BASE_URL}/api/escrows`, {
      data: {
        beneficiary:
          "GBZX4364PEPQTDICMIQDZ56K4T75QGKCRFHSVJFVODVFBRR6XOQNFB2C",
        amount: "100",
        asset: "native",
        deadline: Math.floor(Date.now() / 1000) + 86400, // 24h from now
        metadata: "E2E test escrow",
      },
    });
    expect(createRes.status()).toBe(401);
  });
});
