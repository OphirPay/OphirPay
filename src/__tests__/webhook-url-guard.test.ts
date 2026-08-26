// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isSafeWebhookUrl } from "@/lib/webhook-url-guard";

describe("isSafeWebhookUrl", () => {
  it("accepts public https endpoints", () => {
    expect(isSafeWebhookUrl("https://example.com/webhooks/payments")).toBe(true);
    expect(isSafeWebhookUrl("https://api.stripe.com/hooks")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com:8080/hook")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isSafeWebhookUrl("ftp://example.com/hook")).toBe(false);
    expect(isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeWebhookUrl("gopher://example.com")).toBe(false);
    expect(isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeWebhookUrl("not-a-url")).toBe(false);
  });

  it("rejects loopback and localhost", () => {
    expect(isSafeWebhookUrl("http://localhost:3000/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.1:5432")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.2")).toBe(false);
    expect(isSafeWebhookUrl("http://0.0.0.0")).toBe(false);
    expect(isSafeWebhookUrl("http://[::1]:8080/hook")).toBe(false);
  });

  it("rejects private network ranges", () => {
    expect(isSafeWebhookUrl("http://10.0.0.5/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://172.16.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://172.31.255.255")).toBe(false);
    expect(isSafeWebhookUrl("http://192.168.1.1:9000")).toBe(false);
    expect(isSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeWebhookUrl("http://100.64.0.1")).toBe(false);
  });

  it("rejects internal hostname suffixes", () => {
    expect(isSafeWebhookUrl("http://db.internal/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://api.local/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://my-service.lan")).toBe(false);
    expect(isSafeWebhookUrl("http://metadata.google.internal")).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(isSafeWebhookUrl("http://user:pass@example.com/hook")).toBe(false);
  });

  it("rejects private IPv4-mapped IPv6", () => {
    expect(isSafeWebhookUrl("http://[::ffff:127.0.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[::ffff:10.0.0.1]/hook")).toBe(false);
  });

  it("rejects IPv6 ULA and link-local", () => {
    expect(isSafeWebhookUrl("http://[fc00::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[fe80::1]/hook")).toBe(false);
  });

  it("accepts public IPv6", () => {
    expect(isSafeWebhookUrl("http://[2606:4700:4700::1111]/hook")).toBe(true);
  });
});
