// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildSignedPayload } from "@/lib/webhook-deliver";

const SECRET = "test-secret-0123456789";
const EXAMPLES_DIR = path.resolve(process.cwd(), "examples/webhook-verification");
const NODE_VERIFY = path.join(EXAMPLES_DIR, "node/verify.mjs");
const PY_VERIFY = path.join(EXAMPLES_DIR, "python/verify.py");
const SAMPLE_PAYLOAD = path.join(EXAMPLES_DIR, "sample-payload.json");

const samplePayload = {
  event: "payment.created",
  timestamp: "2026-08-14T00:00:00Z",
  data: { id: "p_123", amount: 100 },
};

// The docs sample: secret + `<timestamp>.<canonical body>` => this exact
// signature. The timestamp is bound into the signed material (issue #702).
const SAMPLE_SIGNATURE = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258";
const SAMPLE_TIMESTAMP = "2026-08-14T00:00:00Z";

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runNode(args: string[], input?: string): RunResult {
  const res = spawnSync("node", [NODE_VERIFY, ...args], { input, encoding: "utf8" });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

function runPython(args: string[], input?: string): RunResult {
  const res = spawnSync("python3", [PY_VERIFY, ...args], { input, encoding: "utf8" });
  return { status: res.status, stdout: String(res.stdout ?? ""), stderr: String(res.stderr ?? "") };
}

// Probe at module scope: `it.skipIf` evaluates its condition during test
// collection, before `beforeAll` hooks run.
const hasPython = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

describe("webhook verification examples — Node (verify.mjs)", () => {
  it("verifies a payload produced by buildSignedPayload", () => {
    const { body, signature } = buildSignedPayload(
      { ...samplePayload, timestamp: new Date().toISOString() },
      SECRET
    );
    const res = runNode(["--secret", SECRET, "--signature", signature], body);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("rejects a tampered body", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const tampered = body.replace('"amount":100', '"amount":999');
    const res = runNode(["--secret", SECRET, "--signature", signature, "--now", "2026-08-14T00:00:30Z"], tampered);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
  });

  it("rejects a wrong secret", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const res = runNode(["--secret", "wrong-secret", "--signature", signature, "--now", "2026-08-14T00:00:30Z"], body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
  });

  it("rejects a replayed (too old) delivery", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    // 1 hour after the payload timestamp exceeds the default 300s window.
    const res = runNode(["--secret", SECRET, "--signature", signature, "--now", "2026-08-14T01:00:00Z"], body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("too old");
  });

  it("verifies the docs sample payload (sample-payload.json)", () => {
    const body = fs.readFileSync(SAMPLE_PAYLOAD, "utf8");
    // Timestamp is fixed in the sample; simulate receipt 30s later.
    const res = runNode(
      ["--secret", SECRET, "--signature", SAMPLE_SIGNATURE, "--now", "2026-08-14T00:00:30Z"],
      body
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("verifies with the X-OphirPay-Timestamp header supplied explicitly", () => {
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const res = runNode(
      [
        "--secret",
        SECRET,
        "--signature",
        signature,
        "--timestamp",
        timestamp,
        "--now",
        "2026-08-14T00:00:30Z",
      ],
      body
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it("rejects a stale header timestamp outside the window even if the body is fresh-looking", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const res = runNode(
      [
        "--secret",
        SECRET,
        "--signature",
        signature,
        "--timestamp",
        SAMPLE_TIMESTAMP,
        "--now",
        "2026-08-14T01:00:00Z",
      ],
      body
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("too old");
  });
});

describe("webhook verification examples — Python (verify.py)", () => {
  it.skipIf(!hasPython)("verifies a payload produced by buildSignedPayload", () => {
    const { body, signature } = buildSignedPayload(
      { ...samplePayload, timestamp: new Date().toISOString() },
      SECRET
    );
    const res = runPython(["--secret", SECRET, "--signature", signature], body);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasPython)("rejects a tampered body", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const tampered = body.replace('"amount":100', '"amount":999');
    const res = runPython(["--secret", SECRET, "--signature", signature, "--now", "2026-08-14T00:00:30Z"], tampered);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
  });

  it.skipIf(!hasPython)("rejects a wrong secret", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const res = runPython(["--secret", "wrong-secret", "--signature", signature, "--now", "2026-08-14T00:00:30Z"], body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("INVALID");
  });

  it.skipIf(!hasPython)("rejects a replayed (too old) delivery", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const res = runPython(["--secret", SECRET, "--signature", signature, "--now", "2026-08-14T01:00:00Z"], body);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("too old");
  });

  it.skipIf(!hasPython)("verifies the docs sample payload (sample-payload.json)", () => {
    const body = fs.readFileSync(SAMPLE_PAYLOAD, "utf8");
    const res = runPython(
      ["--secret", SECRET, "--signature", SAMPLE_SIGNATURE, "--now", "2026-08-14T00:00:30Z"],
      body
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasPython)("verifies with the X-OphirPay-Timestamp header supplied explicitly", () => {
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    const res = runPython(
      [
        "--secret",
        SECRET,
        "--signature",
        signature,
        "--timestamp",
        timestamp,
        "--now",
        "2026-08-14T00:00:30Z",
      ],
      body
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("VALID");
  });

  it.skipIf(!hasPython)("rejects a stale header timestamp outside the window", () => {
    const { body, signature } = buildSignedPayload(samplePayload, SECRET);
    const res = runPython(
      [
        "--secret",
        SECRET,
        "--signature",
        signature,
        "--timestamp",
        SAMPLE_TIMESTAMP,
        "--now",
        "2026-08-14T01:00:00Z",
      ],
      body
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("too old");
  });
});

describe("webhook verification examples — docs consistency", () => {
  it("sample-payload.json signature matches the docs canonical form", () => {
    const { signature } = buildSignedPayload(samplePayload, SECRET);
    expect(signature).toBe(SAMPLE_SIGNATURE);
  });

  it("canonicalizes identically to buildSignedPayload (Node import)", async () => {
    const { canonicalize, verifyWebhookSignature } = await import(
      "../../examples/webhook-verification/node/verify.mjs"
    );
    const body = fs.readFileSync(SAMPLE_PAYLOAD, "utf8");
    const canonical = canonicalize(body);
    expect(canonical).toBe(
      '{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}'
    );
    const { valid } = verifyWebhookSignature({
      body,
      signature: SAMPLE_SIGNATURE,
      secret: SECRET,
      timestamp: SAMPLE_TIMESTAMP,
      maxAgeSeconds: 0,
    });
    expect(valid).toBe(true);
  });

  it("the header timestamp is part of the signed material", async () => {
    const { verifyWebhookSignature } = await import(
      "../../examples/webhook-verification/node/verify.mjs"
    );
    const { body, signature, timestamp } = buildSignedPayload(samplePayload, SECRET);
    // Re-dating the delivery by editing the header invalidates the signature,
    // even though the (unchanged) body still carries the original timestamp.
    const tampered = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp: "2026-08-14T01:00:00Z",
      maxAgeSeconds: 0,
    });
    expect(tampered.valid).toBe(false);
    expect(tampered.reason).toBe("signature mismatch");

    const honest = verifyWebhookSignature({
      body,
      signature,
      secret: SECRET,
      timestamp,
      maxAgeSeconds: 0,
    });
    expect(honest.valid).toBe(true);
  });
});
