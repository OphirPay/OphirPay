// SPDX-License-Identifier: MIT
//
// Content tests for the security disclosure policy (issue #24). These guard
// the acceptance criteria: SECURITY.md must document how to report
// (PGP/email/private), expected response times, supported versions, scope
// (including contracts), and safe-harbor language — and a security issue
// template must exist under .github/ISSUE_TEMPLATE/.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const securityPath = path.join(root, "SECURITY.md");
const templatePath = path.join(
  root,
  ".github",
  "ISSUE_TEMPLATE",
  "security_vulnerability.yml",
);

describe("SECURITY.md (responsible disclosure policy)", () => {
  it("exists", () => {
    expect(existsSync(securityPath)).toBe(true);
  });

  const doc = existsSync(securityPath) ? readFileSync(securityPath, "utf8") : "";

  it("documents how to report via email, PGP, and a private channel", () => {
    expect(doc).toMatch(/security@ophirpay\.com/);
    expect(doc).toMatch(/PGP-encrypted email/);
    expect(doc).toMatch(/private vulnerability reporting/);
    expect(doc).toMatch(/open a public\s+issue/);
    expect(doc).toMatch(/do\s+not[\s\S]*open a public\s+issue/i);
  });

  it("documents expected response times", () => {
    expect(doc).toMatch(/Response expectations/);
    expect(doc).toMatch(/48 hours/);
    expect(doc).toMatch(/5 business days/);
  });

  it("documents supported versions", () => {
    expect(doc).toMatch(/Supported Versions/);
    expect(doc).toMatch(/1\.0\.x/);
    expect(doc).toMatch(/0\.1\.x/);
  });

  it("documents the scope including smart contracts", () => {
    expect(doc).toMatch(/## Scope/);
    expect(doc).toMatch(/contracts\/ophirpay\/src\/lib\.rs/);
    expect(doc).toMatch(/contracts\/emitter\/src\/lib\.rs/);
    expect(doc).toMatch(/Out of scope/);
  });

  it("includes safe-harbor language", () => {
    expect(doc).toMatch(/## Safe Harbor/);
    expect(doc).toMatch(/good\s+faith/);
    expect(doc).toMatch(/legal action/);
  });

  it("points reporters to the issue template", () => {
    expect(doc).toMatch(/security_vulnerability\.yml/);
  });
});

describe(".github/ISSUE_TEMPLATE/security_vulnerability.yml", () => {
  it("exists", () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  const template = existsSync(templatePath)
    ? readFileSync(templatePath, "utf8")
    : "";

  it("is a valid issue template with a security label", () => {
    expect(template).toMatch(/name: 🔒 Security Vulnerability/);
    expect(template).toMatch(/about: Last-resort PUBLIC triage form/);
    expect(template).toMatch(/labels: \[".*security.*"\]/);
  });

  it("warns that the form creates a public issue and forbids exploit details", () => {
    expect(template).toMatch(/creates a PUBLIC issue/);
    expect(template).toMatch(/Do NOT include exploit details/);
    expect(template).toMatch(/security@ophirpay\.com/);
    expect(template).toMatch(/private vulnerability reporting/);
  });

  it("collects severity, affected component, and affected version", () => {
    expect(template).toMatch(/## Severity/);
    expect(template).toMatch(/## Affected Component/);
    expect(template).toMatch(/## Affected Version/);
    expect(template).toMatch(/contracts\/ophirpay\/src\/lib\.rs/);
  });

  it("collects reproduction, impact, and disclosure consent", () => {
    expect(template).toMatch(/## Reproduction Steps/);
    expect(template).toMatch(/## Impact/);
    expect(template).toMatch(/## Disclosure Consent/);
    expect(template).toMatch(/safe harbor/);
  });
});
