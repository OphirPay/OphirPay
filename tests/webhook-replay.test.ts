// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  buildSignedPayload,
  verifyWebhookSignature,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookPayload,
} from "@/lib/webhook-deliver";
import {
  verifyWebhookSignature as verifyNodeVerifierTs,
} from "../examples/webhook-verification/node-verifier";

const SECRET = "whsec_test_secret_0123456789abcdef";
const BASE_NOW = new Date("2026-08-14T12:00:00.000Z");
const BASE_NOW_MS = BASE_NOW.getTime();

const EXAMPLES_DIR = path.resolve(process.cwd(), "examples/webhook-verification");
const NODE_VERIFY_MJS = path.join(EXAMPLES_DIR, "node/verify.mjs");
const NODE_VERIFIER_TS = path.join(EXAMPLES_DIR, "node-verifier.ts");
const PYTHON_VERIFY = path.join(EXAMPLES_DIR, "python/verify.py");
const GO_DIR = path.join(EXAMPLES_DIR, "go");

// Detect Python runtime
function getPythonCommand(): string | null {
  for (const cmd of ["python3", "python"]) {
    const res = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (res.status === 0) return cmd;
  }
  return null;
}

const pythonCmd = getPythonCommand();
const hasGo = spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;

interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runNodeMjs(args: string[], input: string): ExecResult {
  const res = spawnSync("node", [NODE_VERIFY_MJS, ...args], { input, encoding: "utf8" });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

function runNodeTs(args: string[], input: string): ExecResult {
  const res = spawnSync("npx", ["tsx", NODE_VERIFIER_TS, ...args], { input, encoding: "utf8", shell: true });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

function runPython(args: string[], input: string): ExecResult {
  if (!pythonCmd) throw new Error("Python runtime not found");
  const res = spawnSync(pythonCmd, [PYTHON_VERIFY, ...args], { input, encoding: "utf8" });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

function runGo(args: string[], input: string): ExecResult {
  const res = spawnSync("go", ["run", ".", ...args], {
    input,
    encoding: "utf8",
    cwd: GO_DIR,
    env: { ...process.env, GOFLAGS: "-mod=mod" },
  });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

function createSignedOffsetPayload(offsetSeconds: number): {
  payload: WebhookPayload;
  body: string;
  signature: string;
  timestamp: string;
} {
  const timestamp = new Date(BASE_NOW_MS + offsetSeconds * 1000).toISOString();
  const rawPayload: WebhookPayload = {
    event: "payment.completed",
    timestamp,
    data: {
      paymentId: "pay_test_replay_001",
      amount: "100.50",
      asset: "USDC",
    },
  };
  const { body, signature } = buildSignedPayload(rawPayload, SECRET);
  return { payload: rawPayload, body, signature, timestamp };
}

describe("Webhook replay rejection — core library (src/lib/webhook-deliver.ts)", () => {
  it("accepts valid -10s offset (within 300s window)", () => {
    const { body, signature } = createSignedOffsetPayload(-10);
    const result = verifyWebhookSignature({
      rawBody: body,
      signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid -4m (-240s) offset (within 300s window)", () => {
    const { body, signature } = createSignedOffsetPayload(-240);
    const result = verifyWebhookSignature({
      rawBody: body,
      signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects expired -6m (-360s) offset with WebhookTimestampExpired", () => {
    const { body, signature } = createSignedOffsetPayload(-360);
    const result = verifyWebhookSignature({
      rawBody: body,
      signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookTimestampExpired");
    expect(result.reason).toContain("WebhookTimestampExpired");
  });

  it("accepts valid future-skew +2m (+120s) offset (within 300s tolerance)", () => {
    const { body, signature } = createSignedOffsetPayload(120);
    const result = verifyWebhookSignature({
      rawBody: body,
      signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects excessive future-skew +10m (+600s) offset with WebhookTimestampFutureSkew", () => {
    const { body, signature } = createSignedOffsetPayload(600);
    const result = verifyWebhookSignature({
      rawBody: body,
      signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookTimestampFutureSkew");
    expect(result.reason).toContain("WebhookTimestampFutureSkew");
  });
});

describe("Webhook replay rejection — TypeScript reference verifier (node-verifier.ts)", () => {
  it("accepts valid -10s and -4m offsets", () => {
    const p1 = createSignedOffsetPayload(-10);
    const res1 = verifyNodeVerifierTs({
      body: p1.body,
      signature: p1.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(res1.valid).toBe(true);

    const p2 = createSignedOffsetPayload(-240);
    const res2 = verifyNodeVerifierTs({
      body: p2.body,
      signature: p2.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(res2.valid).toBe(true);
  });

  it("rejects -6m offset with WebhookTimestampExpired", () => {
    const p = createSignedOffsetPayload(-360);
    const res = verifyNodeVerifierTs({
      body: p.body,
      signature: p.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("WebhookTimestampExpired");
    expect(res.reason).toContain("WebhookTimestampExpired");
  });

  it("accepts +2m future skew and rejects +10m future skew with WebhookTimestampFutureSkew", () => {
    const validFuture = createSignedOffsetPayload(120);
    const res1 = verifyNodeVerifierTs({
      body: validFuture.body,
      signature: validFuture.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(res1.valid).toBe(true);

    const invalidFuture = createSignedOffsetPayload(600);
    const res2 = verifyNodeVerifierTs({
      body: invalidFuture.body,
      signature: invalidFuture.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(res2.valid).toBe(false);
    expect(res2.code).toBe("WebhookTimestampFutureSkew");
    expect(res2.reason).toContain("WebhookTimestampFutureSkew");
  });
});

describe("Webhook replay rejection — CLI runner for Node (verify.mjs)", () => {
  const nowIso = BASE_NOW.toISOString();

  it("exits 0 with VALID for -10s, -4m, +2m offsets", () => {
    for (const offset of [-10, -240, 120]) {
      const p = createSignedOffsetPayload(offset);
      const res = runNodeMjs(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe("VALID");
    }
  });

  it("exits 1 and reports WebhookTimestampExpired for -6m offset", () => {
    const p = createSignedOffsetPayload(-360);
    const res = runNodeMjs(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it("exits 1 and reports WebhookTimestampFutureSkew for +10m offset", () => {
    const p = createSignedOffsetPayload(600);
    const res = runNodeMjs(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});

describe.skipIf(!pythonCmd)("Webhook replay rejection — CLI runner for Python (verify.py)", () => {
  const nowIso = BASE_NOW.toISOString();

  it("exits 0 with VALID for -10s, -4m, +2m offsets", () => {
    for (const offset of [-10, -240, 120]) {
      const p = createSignedOffsetPayload(offset);
      const res = runPython(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe("VALID");
    }
  });

  it("exits 1 and reports WebhookTimestampExpired for -6m offset", () => {
    const p = createSignedOffsetPayload(-360);
    const res = runPython(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it("exits 1 and reports WebhookTimestampFutureSkew for +10m offset", () => {
    const p = createSignedOffsetPayload(600);
    const res = runPython(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});

describe.skipIf(!hasGo)("Webhook replay rejection — CLI runner for Go (verify.go)", () => {
  const nowIso = BASE_NOW.toISOString();

  it("exits 0 with VALID for -10s, -4m, +2m offsets", () => {
    for (const offset of [-10, -240, 120]) {
      const p = createSignedOffsetPayload(offset);
      const res = runGo(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
      expect(res.status).toBe(0);
      expect(res.stdout.trim()).toBe("VALID");
    }
  });

  it("exits 1 and reports WebhookTimestampExpired for -6m offset", () => {
    const p = createSignedOffsetPayload(-360);
    const res = runGo(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it("exits 1 and reports WebhookTimestampFutureSkew for +10m offset", () => {
    const p = createSignedOffsetPayload(600);
    const res = runGo(["--secret", SECRET, "--signature", p.signature, "--now", nowIso], p.body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});

describe("Replay attack scenario and boundary conditions", () => {
  it("simulates a captured webhook replay attack and correctly rejects it", () => {
    // 1. Initial valid transmission at T0
    const captured = createSignedOffsetPayload(-5);
    const initialVerification = verifyWebhookSignature({
      rawBody: captured.body,
      signature: captured.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(initialVerification.valid).toBe(true);

    // 2. Adversary replays identical raw payload + signature 15 minutes later
    const laterTime = new Date(BASE_NOW_MS + 15 * 60 * 1000);
    const replayAttempt = verifyWebhookSignature({
      rawBody: captured.body,
      signature: captured.signature,
      secret: SECRET,
      now: laterTime,
    });
    expect(replayAttempt.valid).toBe(false);
    expect(replayAttempt.code).toBe("WebhookTimestampExpired");
  });

  it("enforces exact 300s boundary tolerance", () => {
    // Exactly 300 seconds old -> valid
    const exact300 = createSignedOffsetPayload(-300);
    const resExact = verifyWebhookSignature({
      rawBody: exact300.body,
      signature: exact300.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(resExact.valid).toBe(true);

    // 301 seconds old -> expired
    const expired301 = createSignedOffsetPayload(-301);
    const resExpired = verifyWebhookSignature({
      rawBody: expired301.body,
      signature: expired301.signature,
      secret: SECRET,
      now: BASE_NOW,
    });
    expect(resExpired.valid).toBe(false);
    expect(resExpired.code).toBe("WebhookTimestampExpired");
  });

  it("supports configurable maxAgeSeconds parameter", () => {
    const p = createSignedOffsetPayload(-90); // 90 seconds old
    // With 60s maxAge, 90s should be rejected
    const resCustom = verifyWebhookSignature({
      rawBody: p.body,
      signature: p.signature,
      secret: SECRET,
      maxAgeSeconds: 60,
      now: BASE_NOW,
    });
    expect(resCustom.valid).toBe(false);
    expect(resCustom.code).toBe("WebhookTimestampExpired");
  });

  it("respects explicit header timestamp parameter when validating replay", () => {
    const p = createSignedOffsetPayload(-10);
    // Passing an expired header timestamp overrides payload's inner timestamp
    const expiredHeaderTs = new Date(BASE_NOW_MS - 400 * 1000).toISOString();
    const res = verifyWebhookSignature({
      rawBody: p.body,
      signature: p.signature,
      secret: SECRET,
      timestamp: expiredHeaderTs,
      now: BASE_NOW,
    });
    // Signature won't match or timestamp expired
    expect(res.valid).toBe(false);
  });
});
