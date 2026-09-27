// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  isSafeWebhookUrl,
  isSafeWebhookUrlAtDelivery,
  getAllowedWebhookPorts,
  DEFAULT_ALLOWED_WEBHOOK_PORTS,
} from "@/lib/webhook-url-guard";

describe("isSafeWebhookUrl", () => {
  afterEach(() => {
    delete process.env.WEBHOOK_ALLOWED_PORTS;
  });

  it("accepts public https endpoints on the default ports", () => {
    expect(isSafeWebhookUrl("https://example.com/webhooks/payments")).toBe(true);
    expect(isSafeWebhookUrl("https://api.stripe.com/hooks")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:443/hook")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com:80/hook")).toBe(true);
  });

  it("rejects non-standard ports that the allow-list omits (#706)", () => {
    expect(isSafeWebhookUrl("https://public-host:22")).toBe(false);
    expect(isSafeWebhookUrl("https://public-host:6379")).toBe(false);
    expect(isSafeWebhookUrl("http://example.com:8080/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://example.com:3000/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://example.com:5432/hook")).toBe(false);
  });

  it("honours the WEBHOOK_ALLOWED_PORTS override", () => {
    process.env.WEBHOOK_ALLOWED_PORTS = "8443, 9000";
    expect(isSafeWebhookUrl("https://example.com:8443/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:9000/hook")).toBe(true);
    // Once overridden, the defaults no longer apply.
    expect(isSafeWebhookUrl("https://example.com:443/hook")).toBe(false);
  });

  it("falls back to the default ports for an unusable override", () => {
    process.env.WEBHOOK_ALLOWED_PORTS = "not-a-port";
    expect(getAllowedWebhookPorts()).toEqual([...DEFAULT_ALLOWED_WEBHOOK_PORTS]);
    expect(isSafeWebhookUrl("https://example.com/hook")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isSafeWebhookUrl("ftp://example.com/hook")).toBe(false);
    expect(isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeWebhookUrl("gopher://example.com")).toBe(false);
    expect(isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeWebhookUrl("not-a-url")).toBe(false);
  });

  it("rejects loopback and localhost", () => {
    expect(isSafeWebhookUrl("http://localhost:80/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://localhost:443/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.1:5432")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.2")).toBe(false);
    expect(isSafeWebhookUrl("http://0.0.0.0")).toBe(false);
    expect(isSafeWebhookUrl("http://[::1]/hook")).toBe(false);
  });

  it("rejects private network ranges", () => {
    expect(isSafeWebhookUrl("http://10.0.0.5/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://172.16.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://172.31.255.255")).toBe(false);
    expect(isSafeWebhookUrl("http://192.168.1.1:9000")).toBe(false);
    expect(isSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeWebhookUrl("http://100.64.0.1")).toBe(false);
  });

  it("rejects documentation, benchmarking and multicast IPv4 ranges", () => {
    expect(isSafeWebhookUrl("http://192.0.2.10/hook")).toBe(false); // TEST-NET-1
    expect(isSafeWebhookUrl("http://198.51.100.7/hook")).toBe(false); // TEST-NET-2
    expect(isSafeWebhookUrl("http://203.0.113.9/hook")).toBe(false); // TEST-NET-3
    expect(isSafeWebhookUrl("http://198.18.0.1/hook")).toBe(false); // benchmarking
    expect(isSafeWebhookUrl("http://224.0.0.1/hook")).toBe(false); // multicast
    expect(isSafeWebhookUrl("http://240.0.0.1/hook")).toBe(false); // reserved
  });

  it("rejects internal hostname suffixes", () => {
    expect(isSafeWebhookUrl("http://db.internal/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://api.local/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://my-service.lan")).toBe(false);
    expect(isSafeWebhookUrl("http://metadata.google.internal")).toBe(false);
    expect(isSafeWebhookUrl("http://printer.home.arpa")).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(isSafeWebhookUrl("https://user:pass@example.com/hook")).toBe(false);
  });

  it("rejects private IPv4-mapped IPv6", () => {
    expect(isSafeWebhookUrl("https://[::ffff:127.0.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[::ffff:10.0.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[::ffff:169.254.169.254]/hook")).toBe(false);
  });

  it("rejects IPv6 ULA, link-local and multicast", () => {
    expect(isSafeWebhookUrl("https://[fc00::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[fd12:3456::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[fe80::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://[ff02::1]/hook")).toBe(false);
  });

  it("accepts public IPv6 and public IPv4-mapped IPv6", () => {
    expect(isSafeWebhookUrl("https://[2606:4700:4700::1111]/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://[::ffff:93.184.216.34]/hook")).toBe(true);
  });
});

describe("isSafeWebhookUrlAtDelivery (DNS re-validation, #706)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    delete process.env.WEBHOOK_ALLOWED_PORTS;
  });

  it("allows a hostname that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(
      isSafeWebhookUrlAtDelivery("https://example.com/hook")
    ).resolves.toBe(true);
  });

  it("refuses a hostname that resolves to any private address", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      isSafeWebhookUrlAtDelivery("https://example.com/hook")
    ).resolves.toBe(false);
  });

  it("refuses a target whose resolution flips between checks (rebinding)", async () => {
    // Public at registration/check time…
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      isSafeWebhookUrlAtDelivery("https://rebind.example.com/hook")
    ).resolves.toBe(true);

    // …private on the next resolution.
    lookupMock.mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }]);
    await expect(
      isSafeWebhookUrlAtDelivery("https://rebind.example.com/hook")
    ).resolves.toBe(false);
  });

  it("refuses a disallowed port before any DNS lookup", async () => {
    await expect(
      isSafeWebhookUrlAtDelivery("https://example.com:6379/hook")
    ).resolves.toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
