// SPDX-License-Identifier: MIT
//
// Content tests for the troubleshooting guide (issue #23). These guard the
// acceptance criteria: the guide must document fixes for Freighter not
// detected, Rust/wasm32 target missing, Prisma migration errors, WASM build
// failures, Node version mismatch, and port conflicts — each as
// symptom → cause → resolution — and be linked from README and CONTRIBUTING.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "TROUBLESHOOTING.md");
const readmePath = path.join(root, "README.md");
const contributingPath = path.join(root, "CONTRIBUTING.md");

describe("docs/TROUBLESHOOTING.md (setup troubleshooting guide)", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("documents the Freighter-not-detected issue with symptom, cause, resolution", () => {
    expect(doc).toMatch(/## 1\. Freighter not detected/);
    expect(doc).toMatch(/\*\*Symptom\*\*/);
    expect(doc).toMatch(/\*\*Cause\*\*/);
    expect(doc).toMatch(/\*\*Resolution\*\*/);
    expect(doc).toMatch(/freighter\.app/);
  });

  it("documents the missing Rust wasm32 target issue", () => {
    expect(doc).toMatch(/## 2\. Rust wasm32 target missing/);
    expect(doc).toMatch(/wasm32v1-none/);
    expect(doc).toMatch(/rustup target add wasm32v1-none/);
  });

  it("documents Prisma migration errors", () => {
    expect(doc).toMatch(/## 3\. Prisma migration errors/);
    expect(doc).toMatch(/DATABASE_URL/);
    expect(doc).toMatch(/npx prisma db push/);
    expect(doc).toMatch(/npx prisma generate/);
  });

  it("documents WASM build failures", () => {
    expect(doc).toMatch(/## 4\. WASM build failures/);
    expect(doc).toMatch(/cargo build --target wasm32v1-none --release/);
  });

  it("documents Node version mismatch", () => {
    expect(doc).toMatch(/## 5\. Node version mismatch/);
    expect(doc).toMatch(/\.nvmrc/);
  });

  it("documents port conflicts", () => {
    expect(doc).toMatch(/## 6\. Port conflicts/);
    expect(doc).toMatch(/EADDRINUSE/);
    expect(doc).toMatch(/-p 3001/);
  });

  it("gives every entry the symptom → cause → resolution structure", () => {
    const entries = doc.match(/## \d\./g);
    expect(entries).not.toBeNull();
    expect(entries!.length).toBeGreaterThanOrEqual(6);
    // Each numbered entry must contain all three labelled sections.
    for (let i = 1; i <= 6; i++) {
      const next = doc.indexOf(`## ${i + 1}.`);
      const end = next === -1 ? doc.length : next;
      const entry = doc.slice(doc.indexOf(`## ${i}.`), end);
      expect(entry).toMatch(/\*\*Symptom\*\*/);
      expect(entry).toMatch(/\*\*Cause\*\*/);
      expect(entry).toMatch(/\*\*Resolution\*\*/);
    }
  });

  it("includes quick checks and a still-stuck section", () => {
    expect(doc).toMatch(/## Quick checks/);
    expect(doc).toMatch(/## Still stuck\?/);
  });
});

describe("troubleshooting guide links", () => {
  it("is linked from README.md", () => {
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    expect(readme).toMatch(/docs\/TROUBLESHOOTING\.md/);
  });

  it("is linked from CONTRIBUTING.md", () => {
    const contributing = existsSync(contributingPath)
      ? readFileSync(contributingPath, "utf8")
      : "";
    expect(contributing).toMatch(/docs\/TROUBLESHOOTING\.md/);
  });
});
