#!/usr/bin/env node

// Issue #1419 — Verification test suite for markdown link integrity checker
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/check-markdown-links.mjs");

test("passes on all existing documentation files in the repository", () => {
  const output = execSync(`node "${scriptPath}"`, {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(output, /no broken links found/);
});

test("accepts explicit markdown file targets from command line", () => {
  const output = execSync(
    `node "${scriptPath}" README.md CONTRIBUTING.md GLOSSARY.md`,
    {
      cwd: root,
      encoding: "utf8",
    }
  );
  assert.match(output, /Checked Markdown links in 3 file\(s\)/);
  assert.match(output, /no broken links found/);
});

test("detects missing relative files and outputs exact line numbers and annotations", () => {
  const tempDoc = path.join(root, "docs/temp-broken-test.md");
  try {
    fs.writeFileSync(
      tempDoc,
      "# Title\n\nLine 3 has a [broken link](./missing-xyz-123.md).\n",
      "utf8"
    );

    assert.throws(
      () => {
        execSync(`node "${scriptPath}" --annotate "${tempDoc}"`, {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      (err) => {
        const stderr = err.stderr ? err.stderr.toString() : "";
        const stdout = err.stdout ? err.stdout.toString() : "";
        const combined = stderr + stdout;
        assert.match(combined, /missing file \.\/missing-xyz-123\.md/);
        assert.match(combined, /::error file=docs[\\/]temp-broken-test\.md,line=3::/);
        return true;
      }
    );
  } finally {
    try {
      fs.unlinkSync(tempDoc);
    } catch {
      // ignore
    }
  }
});

test("ignores third-party external domains to eliminate rate limit flakiness", () => {
  const tempDoc = path.join(root, "docs/temp-external-test.md");
  try {
    fs.writeFileSync(
      tempDoc,
      "# Title\n\n[Stellar](https://stellar.org)\n[GitHub](https://github.com/OphirPay/OphirPay)\n[Email](mailto:dev@ophirpay.com)\n",
      "utf8"
    );

    const output = execSync(`node "${scriptPath}" "${tempDoc}"`, {
      cwd: root,
      encoding: "utf8",
    });
    assert.match(output, /no broken links found/);
  } finally {
    try {
      fs.unlinkSync(tempDoc);
    } catch {
      // ignore
    }
  }
});
