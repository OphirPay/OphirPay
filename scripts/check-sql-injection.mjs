#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Issue #1396 — CI security script to detect unparameterized raw SQL and blocked $queryRawUnsafe calls.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");

/**
 * @typedef {Object} Violation
 * @property {string} file
 * @property {number} line
 * @property {string} snippet
 * @property {string} reason
 */

/** @type {Violation[]} */
const violations = [];

/**
 * Recursively find all source files in a directory.
 * @param {string} dir
 * @param {string[]} [fileList]
 * @returns {string[]}
 */
function walk(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        walk(fullPath, fileList);
      }
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const files = walk(srcDir);

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const relPath = path.relative(rootDir, file).replace(/\\/g, "/");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : "";

    // Check for exemption comment
    if (
      line.includes("@allow-unsafe-sql-audit-exempt") ||
      prevLine.includes("@allow-unsafe-sql-audit-exempt")
    ) {
      continue;
    }

    // 1. Check for $queryRawUnsafe or $executeRawUnsafe
    if (/\$(queryRawUnsafe|executeRawUnsafe)\s*\(/.test(line)) {
      violations.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim(),
        reason:
          "Forbidden use of $queryRawUnsafe/$executeRawUnsafe. Use tagged template $queryRaw`...` or Prisma.sql with parameterized variable bindings.",
      });
    }

    // 2. Check for dynamic string concatenation inside $queryRaw / $executeRaw calls
    // e.g. prisma.$queryRaw("SELECT ... " + userInput)
    if (/\$(queryRaw|executeRaw)\s*\([^`].*\+/.test(line)) {
      violations.push({
        file: relPath,
        line: i + 1,
        snippet: line.trim(),
        reason:
          "Unparameterized string concatenation detected inside raw SQL call. Use Prisma.sql tagged template literals.",
      });
    }
  }
}

console.log("Auditing Prisma queries across src/ for SQL injection vulnerabilities (#1396)...");
console.log(`Scanned ${files.length} source files.`);

if (violations.length > 0) {
  console.error(`\n❌ Found ${violations.length} potential SQL injection violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    Snippet: ${v.snippet}`);
    console.error(`    Reason:  ${v.reason}\n`);
  }
  process.exit(1);
}

console.log("✅ SQL injection check passed: zero unparameterized raw SQL queries found.");
process.exit(0);
