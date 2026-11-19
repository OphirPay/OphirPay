// SPDX-License-Identifier: MIT
//
// Issue #1280 — the security contact documented by the project must actually
// accept reports. These tests pin the served RFC 9116 document to working
// channels, keep it in sync with the repository copy, and make sure the retired
// `security@ophirpay.com` mailbox is never advertised again.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SECURITY_TXT_CONTACTS,
  SECURITY_TXT_EXPIRES,
  generateSecurityTxt,
} from "@/lib/security-txt";
import { GET, HEAD, OPTIONS } from "@/app/.well-known/security.txt/route";

const root = path.resolve(__dirname, "../..");
const repoFile = readFileSync(path.join(root, ".well-known", "security.txt"), "utf8");

function contactsOf(document: string): string[] {
  return document
    .split("\n")
    .filter((line) => line.startsWith("Contact:"))
    .map((line) => line.slice("Contact:".length).trim());
}

describe("RFC 9116 security.txt", () => {
  it("advertises the GitHub advisory form as the contact", () => {
    const contacts = contactsOf(generateSecurityTxt());
    expect(contacts).toEqual(["https://github.com/OphirPay/OphirPay/security/advisories/new"]);
  });

  it("advertises no mailbox while neither domain can receive mail", () => {
    // .com has no MX records and .dev does not resolve (issue #1280), so a
    // mailto contact would silently swallow reports.
    for (const document of [generateSecurityTxt(), repoFile]) {
      expect(contactsOf(document).join("\n")).not.toMatch(/mailto:|security@ophirpay\./);
    }
  });

  it("includes the required Expires, Canonical and Policy fields", () => {
    const document = generateSecurityTxt("https://staging.example.com/");
    expect(document).toContain(`Expires: ${SECURITY_TXT_EXPIRES}`);
    expect(document).toContain("Canonical: https://staging.example.com/.well-known/security.txt");
    expect(document).toContain("Policy: https://github.com/OphirPay/OphirPay/blob/main/SECURITY.md");
  });

  it("stays in sync with the repository .well-known/security.txt", () => {
    expect(contactsOf(repoFile)).toEqual([...SECURITY_TXT_CONTACTS]);
    expect(repoFile).toContain(`Expires: ${SECURITY_TXT_EXPIRES}`);
  });

  it("serves text/plain with wildcard CORS and supports HEAD/OPTIONS", () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    expect(HEAD().status).toBe(200);
    const preflight = OPTIONS();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
