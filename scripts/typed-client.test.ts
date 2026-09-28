// SPDX-License-Identifier: MIT

/**
 * Client-coverage suite for @ophirpay/client (issue #822).
 *
 * The client is exercised against a real local HTTP server that speaks the
 * OphirPay response envelope, so the request/response handling is covered by
 * tests rather than only documented. The CLI is exercised as a subprocess
 * against the same server to assert its exit codes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import {
  OphirPayClient,
  OphirPayError,
  verifyWebhookSignature,
  canonicalizeWebhookBody,
  webhookSignedInput,
} from "../packages/ophirpay-client/index.js";

// ── Local fake server ──────────────────────────────────────────

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

let server: http.Server;
let baseUrl: string;
const requests: RecordedRequest[] = [];

function send(res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = raw;
      }
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: parsed,
      });

      const url = req.url ?? "";

      if (req.method === "POST" && url === "/api/payments") {
        const input = parsed as { amount?: number };
        if (!input?.amount || input.amount <= 0) {
          return send(res, 400, {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "amount must be positive" },
          });
        }
        return send(res, 201, {
          success: true,
          data: {
            id: "pay_1",
            amount: input.amount,
            assetCode: "XLM",
            assetIssuer: null,
            description: null,
            memo: null,
            status: "PENDING",
            transactionHash: null,
            idempotencyKey: null,
          },
        });
      }

      if (req.method === "GET" && url.startsWith("/api/payments/")) {
        return send(res, 200, {
          success: true,
          data: {
            id: url.split("/").pop(),
            amount: 25,
            assetCode: "XLM",
            assetIssuer: null,
            description: null,
            memo: null,
            status: "COMPLETED",
            transactionHash: "abc123",
            idempotencyKey: null,
          },
        });
      }

      if (req.method === "POST" && url === "/api/batches") {
        const input = parsed as { recipients?: Array<{ address: string }> };
        const recipients = input?.recipients ?? [];
        const hasReject = recipients.some((r) => r.address === "GREJECT");
        return send(res, 201, {
          success: true,
          data: {
            id: "batch_1",
            payments: recipients.map((r, i) => ({
              id: `pay_${i}`,
              amount: 1,
              assetCode: "XLM",
              assetIssuer: null,
              description: null,
              memo: null,
              status: r.address === "GREJECT" ? "FAILED" : "PENDING",
              transactionHash: null,
              idempotencyKey: null,
            })),
          },
        });
      }

      if (req.method === "GET" && url === "/api/stats") {
        return send(res, 200, { success: true, data: { total_payments_recorded: 3 } });
      }

      return send(res, 404, {
        success: false,
        error: { code: "NOT_FOUND", message: "not found" },
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client() {
  return new OphirPayClient({ baseUrl, apiKey: "oph_test" });
}

// ── Client ─────────────────────────────────────────────────────

describe("@ophirpay/client against a local server", () => {
  it("creates a payment and sends the bearer token", async () => {
    const payment = await client().createPayment({ recipient: "GABC", amount: 25 });
    expect(payment.id).toBe("pay_1");
    expect(payment.status).toBe("PENDING");

    const req = requests.at(-1)!;
    expect(req.headers.authorization).toBe("Bearer oph_test");
  });

  it("retrieves a payment by id", async () => {
    const payment = await client().getPayment("pay_42");
    expect(payment.id).toBe("pay_42");
    expect(payment.status).toBe("COMPLETED");
  });

  it("forwards an idempotency key as a header", async () => {
    const c = client();
    await c.createBatch(
      { recipients: [{ address: "GABC", amount: 1 }] },
      { idempotencyKey: "idem-123" }
    );
    expect(requests.at(-1)!.headers["idempotency-key"]).toBe("idem-123");
  });

  it("submits a batch and returns its child payments", async () => {
    const batch = await client().createBatch({
      recipients: [
        { address: "GABC", amount: 1 },
        { address: "GDEF", amount: 2 },
      ],
    });
    expect(batch.id).toBe("batch_1");
    expect(batch.payments).toHaveLength(2);
  });

  it("throws OphirPayError with the API error code on 400", async () => {
    await expect(client().createPayment({ amount: 0 })).rejects.toMatchObject({
      name: "OphirPayError",
      status: 400,
      code: "VALIDATION_ERROR",
    });
  });

  it("resolves operations from the generated OpenAPI catalogue", () => {
    const c = client();
    expect(c.operation("postApiPayments").path).toBe("/api/payments");
    expect(c.operation("getApiPaymentsId").path).toBe("/api/payments/{id}");
    expect(() => c.operation("nope" as never)).toThrow(OphirPayError);
  });

  it("reports a transport failure as an OphirPayError", async () => {
    const c = new OphirPayClient({ baseUrl: "http://127.0.0.1:1", apiKey: "x" });
    await expect(c.getStats()).rejects.toBeInstanceOf(OphirPayError);
  });
});

// ── Webhook verification ───────────────────────────────────────

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test";
  const now = 1_700_000_000_000;
  const timestamp = String(Math.floor(now / 1000));

  function sign(payload: Record<string, unknown>) {
    const signature = crypto
      .createHmac("sha256", secret)
      .update(webhookSignedInput(timestamp, canonicalizeWebhookBody(payload)))
      .digest("hex");
    return JSON.stringify({ ...payload, signature });
  }

  it("accepts a correctly signed, fresh body", () => {
    const rawBody = sign({ event: "payment.completed", timestamp, data: { id: "p1" } });
    expect(
      verifyWebhookSignature({ rawBody, signature: JSON.parse(rawBody).signature, timestamp, secret, now })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const rawBody = sign({ event: "payment.completed", timestamp, data: { id: "p1" } });
    const tampered = rawBody.replace('"p1"', '"p2"');
    expect(
      verifyWebhookSignature({
        rawBody: tampered,
        signature: JSON.parse(rawBody).signature,
        timestamp,
        secret,
        now,
      })
    ).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", () => {
    const rawBody = sign({ event: "payment.completed", timestamp, data: {} });
    expect(
      verifyWebhookSignature({
        rawBody,
        signature: JSON.parse(rawBody).signature,
        timestamp,
        secret,
        now: now + 3_600_000,
      })
    ).toBe(false);
  });

  it("rejects missing inputs and malformed JSON", () => {
    expect(verifyWebhookSignature({ rawBody: "", signature: "x", timestamp, secret })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: "not json", signature: "x", timestamp, secret, now })).toBe(false);
  });
});

// ── CLI ────────────────────────────────────────────────────────

describe("ophirpay CLI", () => {
  const cliPath = join(process.cwd(), "scripts", "ophirpay-cli.mjs");

  const execFileAsync = promisify(execFile);

  /**
   * Run the CLI asynchronously: `execFile` (not `execFileSync`) so this
   * process's event loop keeps serving the local HTTP server the CLI calls.
   */
  async function runCli(args: string[]): Promise<{ status: number; stdout: string }> {
    try {
      const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
        env: {
          ...process.env,
          OPHIRPAY_BASE_URL: baseUrl,
          OPHIRPAY_API_KEY: "oph_test",
        },
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { status: e.code ?? 1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  it("submits a batch from a CSV and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ophirpay-cli-"));
    const file = join(dir, "recipients.csv");
    writeFileSync(file, "address,amount\nGABC,5\nGDEF,10\n");

    const { status, stdout } = await runCli([
      "batch:submit", "--file", file, "--name", "payroll",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("batch batch_1");

    const lastBatch = requests.filter((r) => r.url === "/api/batches").at(-1)!;
    expect((lastBatch.body as { recipients: unknown[] }).recipients).toHaveLength(2);
  });

  it("fails the job (non-zero exit) when a payment is rejected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ophirpay-cli-"));
    const file = join(dir, "recipients.csv");
    writeFileSync(file, "address,amount\nGABC,5\nGREJECT,10\n");

    const { status, stdout } = await runCli(["batch:submit", "--file", file]);
    expect(status).toBe(1);
    expect(stdout).toContain("rejected");
  });

  it("verifies a webhook signature and fails on an invalid one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ophirpay-cli-"));
    const file = join(dir, "body.json");
    const secret = "whsec_cli";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = { event: "payment.completed", timestamp, data: { id: "p1" } };
    const signature = crypto
      .createHmac("sha256", secret)
      .update(webhookSignedInput(timestamp, canonicalizeWebhookBody(payload)))
      .digest("hex");
    writeFileSync(file, JSON.stringify({ ...payload, signature }));

    const ok = await runCli([
      "webhook:verify", "--secret", secret, "--body-file", file,
      "--signature", signature, "--timestamp", timestamp,
    ]);
    expect(ok.status).toBe(0);

    const bad = await runCli([
      "webhook:verify", "--secret", secret, "--body-file", file,
      "--signature", "deadbeef", "--timestamp", timestamp,
    ]);
    expect(bad.status).toBe(1);
  });

  it("prints help", async () => {
    const { status, stdout } = await runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("batch:submit");
  });
});
