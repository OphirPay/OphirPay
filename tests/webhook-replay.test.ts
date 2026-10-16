// SPDX-License-Identifier: MIT
/**
 * Webhook signature timestamp verification and replay rejection integration tests.
 *
 * Validates timestamp freshness window tolerances and rejection error codes across
 * reference verifier implementations (TypeScript, Node.js, Python, Go):
 *
 * Offsets tested relative to reference time (now):
 *   - -10s : Fresh payload -> VALID
 *   - -4m  : Within 5m tolerance window -> VALID
 *   - -6m  : Exceeds 5m tolerance window -> REJECTED (WebhookTimestampExpired)
 *   - +2m  : Minor future clock skew within 5m allowance -> VALID
 *   - +10m : Excessive future skew exceeding 5m allowance -> REJECTED (WebhookTimestampFutureSkew)
 *
 * Generated for Issue #1409.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildSignedPayload, type WebhookPayload } from "@/lib/webhook-deliver";
import {
  verifyWebhookSignature,
  DEFAULT_MAX_AGE_SECONDS,
} from "../examples/webhook-verification/node-verifier";

const SECRET = "whsec_test_replay_tolerance_key_9876543210";
const ROOT_DIR = process.cwd();
const EXAMPLES_DIR = path.resolve(ROOT_DIR, "examples/webhook-verification");
const NODE_VERIFY = path.join(EXAMPLES_DIR, "node/verify.mjs");
const PY_VERIFY = path.join(EXAMPLES_DIR, "python/verify.py");
const GO_DIR = path.join(EXAMPLES_DIR, "go");

// Fixed reference instant for deterministic timing in tests
const BASE_NOW = new Date("2026-10-15T12:00:00.000Z");

const sampleData = {
  event: "payment.completed",
  data: {
    id: "pay_test_replay_001",
    amount: 5000,
    asset: "USDC",
    recipient: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
  },
};

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runNode(args: string[], input: string): RunResult {
  const res = spawnSync("node", [NODE_VERIFY, ...args], {
    input,
    encoding: "utf8",
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

// Detect python command on current platform (python on Windows, python3 on Unix)
const pythonBin = (() => {
  const check = (cmd: string) =>
    spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
  if (check("python3")) return "python3";
  if (check("python")) return "python";
  return null;
})();

function runPython(args: string[], input: string): RunResult {
  if (!pythonBin) throw new Error("Python binary not found");
  const res = spawnSync(pythonBin, [PY_VERIFY, ...args], {
    input,
    encoding: "utf8",
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

const hasGo = spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;

function runGo(args: string[], input: string): RunResult {
  const res = spawnSync("go", ["run", ".", ...args], {
    input,
    encoding: "utf8",
    cwd: GO_DIR,
    env: { ...process.env, GOFLAGS: "-mod=mod" },
  });
  return {
    status: res.status,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

/** Helper to generate valid signed delivery payload with given timestamp */
function createDelivery(timestampIso: string) {
  const payload: WebhookPayload = {
    ...sampleData,
    timestamp: timestampIso,
  };
  return buildSignedPayload(payload, SECRET);
}

// ── 1. TypeScript Module Reference (node-verifier.ts) ─────────────────────────

describe("Webhook Replay Rejection — TypeScript Verifier (node-verifier.ts)", () => {
  it("accepts a payload delivered -10 seconds in the past", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 10 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("valid");
    expect(result.code).toBeUndefined();
  });

  it("accepts a payload delivered -4 minutes in the past (within 5m window)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 4 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("valid");
  });

  it("rejects a replayed payload -6 minutes in the past with WebhookTimestampExpired", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 6 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookTimestampExpired");
    expect(result.reason).toContain("WebhookTimestampExpired");
    expect(result.reason).toContain("possible replay");
  });

  it("accepts a payload with +2 minutes future clock skew (within allowance)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 2 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("valid");
  });

  it("rejects an excessive +10 minutes future clock skew with WebhookTimestampFutureSkew", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 10 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookTimestampFutureSkew");
    expect(result.reason).toContain("WebhookTimestampFutureSkew");
    expect(result.reason).toContain("in the future");
  });

  it("resolves timestamp from body when header timestamp is omitted", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 6 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      // No timestamp header provided
      maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookTimestampExpired");
  });

  it("rejects a payload with signature mismatch before timestamp checks", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 10 * 1000).toISOString();
    const { body } = createDelivery(timestamp);

    const result = verifyWebhookSignature({
      body,
      signature: "0000000000000000000000000000000000000000000000000000000000000000",
      secret: SECRET,
      timestamp,
      now: BASE_NOW,
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe("WebhookSignatureMismatch");
  });
});

// ── 2. Node.js Reference Implementation (verify.mjs) ──────────────────────────

describe("Webhook Replay Rejection — Node.js CLI (verify.mjs)", () => {
  it("accepts -10s payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 10 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runNode(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("accepts -4m payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 4 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runNode(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("rejects -6m replayed payload with WebhookTimestampExpired (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 6 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runNode(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it("accepts +2m future skew within tolerance (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 2 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runNode(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("rejects +10m excessive future skew with WebhookTimestampFutureSkew (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 10 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runNode(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});

// ── 3. Python Reference Implementation (verify.py) ────────────────────────────

describe("Webhook Replay Rejection — Python CLI (verify.py)", () => {
  it.skipIf(!pythonBin)("accepts -10s payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 10 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runPython(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!pythonBin)("accepts -4m payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 4 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runPython(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!pythonBin)("rejects -6m replayed payload with WebhookTimestampExpired (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 6 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runPython(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it.skipIf(!pythonBin)("accepts +2m future skew within tolerance (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 2 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runPython(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!pythonBin)("rejects +10m excessive future skew with WebhookTimestampFutureSkew (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 10 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runPython(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});

// ── 4. Go Reference Implementation (verify.go) ────────────────────────────────

describe("Webhook Replay Rejection — Go CLI (verify.go)", () => {
  it.skipIf(!hasGo)("accepts -10s payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 10 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runGo(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasGo)("accepts -4m payload (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 4 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runGo(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasGo)("rejects -6m replayed payload with WebhookTimestampExpired (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() - 6 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runGo(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampExpired");
  });

  it.skipIf(!hasGo)("accepts +2m future skew within tolerance (exit 0)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 2 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runGo(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasGo)("rejects +10m excessive future skew with WebhookTimestampFutureSkew (exit 1)", () => {
    const timestamp = new Date(BASE_NOW.getTime() + 10 * 60 * 1000).toISOString();
    const { body, signature } = createDelivery(timestamp);

    const res = runGo(
      [
        "--secret", SECRET,
        "--signature", signature,
        "--timestamp", timestamp,
        "--now", BASE_NOW.toISOString(),
      ],
      body
    );

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
    expect(res.stderr).toContain("WebhookTimestampFutureSkew");
  });
});
