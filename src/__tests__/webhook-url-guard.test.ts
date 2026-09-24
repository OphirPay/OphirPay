// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { isSafeWebhookUrl, isSafeWebhookUrlAtDelivery } from "@/lib/webhook-url-guard";

describe("isSafeWebhookUrl", () => {
  it("accepts public https endpoints on default ports", () => {
    expect(isSafeWebhookUrl("https://example.com/webhooks/payments")).toBe(true);
    expect(isSafeWebhookUrl("https://api.stripe.com/hooks")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com/hook")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com:80/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:443/hook")).toBe(true);
  });

  it("rejects non-standard ports by default", () => {
    expect(isSafeWebhookUrl("http://example.com:8080/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com:22/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com:6379/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://example.com:8443/hook")).toBe(false);
  });

  it("allows configurable custom allowed ports when specified", () => {
    expect(isSafeWebhookUrl("http://example.com:8080/hook", { allowedPorts: [80, 443, 8080] })).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:8443/hook", { allowedPorts: [8443] })).toBe(true);
    expect(isSafeWebhookUrl("http://example.com:80/hook", { allowedPorts: [443] })).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isSafeWebhookUrl("ftp://example.com/hook")).toBe(false);
    expect(isSafeWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeWebhookUrl("gopher://example.com")).toBe(false);
    expect(isSafeWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeWebhookUrl("not-a-url")).toBe(false);
  });

  it("rejects loopback and localhost", () => {
    expect(isSafeWebhookUrl("http://localhost/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://localhost:80/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.1:80")).toBe(false);
    expect(isSafeWebhookUrl("http://127.0.0.2")).toBe(false);
    expect(isSafeWebhookUrl("http://0.0.0.0")).toBe(false);
    expect(isSafeWebhookUrl("http://[::1]/hook")).toBe(false);
  });

  it("rejects private network ranges", () => {
    expect(isSafeWebhookUrl("http://10.0.0.5/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://172.16.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://172.31.255.255")).toBe(false);
    expect(isSafeWebhookUrl("http://192.168.1.1")).toBe(false);
    expect(isSafeWebhookUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeWebhookUrl("http://100.64.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://192.0.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://198.18.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://224.0.0.1")).toBe(false);
    expect(isSafeWebhookUrl("http://240.0.0.1")).toBe(false);
  });

  it("rejects internal hostname suffixes", () => {
    expect(isSafeWebhookUrl("http://db.internal/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://api.local/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://my-service.lan")).toBe(false);
    expect(isSafeWebhookUrl("http://app.localdomain")).toBe(false);
    expect(isSafeWebhookUrl("http://metadata.google.internal")).toBe(false);
    expect(isSafeWebhookUrl("http://instance-data.ec2.internal")).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(isSafeWebhookUrl("http://user:pass@example.com/hook")).toBe(false);
  });

  it("rejects private IPv4-mapped and IPv4-compatible IPv6", () => {
    expect(isSafeWebhookUrl("http://[::ffff:127.0.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[::ffff:10.0.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[::ffff:192.168.0.1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[::127.0.0.1]/hook")).toBe(false);
  });

  it("rejects IPv6 ULA, link-local, multicast, documentation", () => {
    expect(isSafeWebhookUrl("http://[fc00::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[fd12:3456:789a::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[fe80::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[ff02::1]/hook")).toBe(false);
    expect(isSafeWebhookUrl("http://[2001:db8::1]/hook")).toBe(false);
  });

  it("accepts public IPv6 literals on standard ports", () => {
    expect(isSafeWebhookUrl("http://[2606:4700:4700::1111]/hook")).toBe(true);
    expect(isSafeWebhookUrl("https://[2606:4700:4700::1111]:443/hook")).toBe(true);
  });
});

describe("isSafeWebhookUrlAtDelivery & DNS re-validation", () => {
  it("resolves and approves public domain", async () => {
    const mockLookup = async () => [{ address: "93.184.216.34", family: 4 }];
    const safe = await isSafeWebhookUrlAtDelivery("https://example.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(true);
  });

  it("rejects domain resolving to private IPv4", async () => {
    const mockLookup = async () => [{ address: "192.168.1.50", family: 4 }];
    const safe = await isSafeWebhookUrlAtDelivery("https://rebinding.attacker.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(false);
  });

  it("rejects domain resolving to loopback IPv4", async () => {
    const mockLookup = async () => [{ address: "127.0.0.1", family: 4 }];
    const safe = await isSafeWebhookUrlAtDelivery("https://rebinding.attacker.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(false);
  });

  it("rejects domain resolving to IPv6 ULA or loopback", async () => {
    const mockLookup = async () => [{ address: "fd00::1", family: 6 }];
    const safe = await isSafeWebhookUrlAtDelivery("https://rebinding.attacker.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(false);
  });

  it("rejects domain if one of multiple addresses is private", async () => {
    const mockLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    const safe = await isSafeWebhookUrlAtDelivery("https://multi-ip.attacker.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(false);
  });

  it("rejects when DNS lookup fails", async () => {
    const mockLookup = async () => {
      throw new Error("ENOTFOUND");
    };
    const safe = await isSafeWebhookUrlAtDelivery("https://nonexistent-host-xyz.com/webhook", { dnsLookup: mockLookup });
    expect(safe).toBe(false);
  });
});
