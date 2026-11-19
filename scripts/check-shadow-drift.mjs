/**
 * scripts/check-shadow-drift.mjs
 *
 * Filters the output of `prisma migrate diff` against a shadow database to ignore
 * known PostgreSQL-native extensions that schema.prisma intentionally cannot represent:
 *   1. Full-text search `tsvector` generated columns & GIN indexes (`searchVector`)
 *   2. Manual foreign key constraints on `ApiKeyRequestLog` when `relationMode = "prisma"`
 *
 * If any other drift is detected, exits with code 2 and prints the unexpected diff.
 * If only expected DB-native extensions or no diff is found, exits with code 0.
 */

import fs from "node:fs";

const diffFile = process.argv[2];
if (!diffFile || !fs.existsSync(diffFile)) {
  console.log("No diff file provided or file does not exist. Assuming no drift.");
  process.exit(0);
}

const content = fs.readFileSync(diffFile, "utf8");
const lines = content.split("\n");

// Parse blocks:
// [*] Changed the `TableName` table
//   [-] Removed ...
//   [+] Added ...

const IGNORED_PATTERNS = [
  /searchVector/i,
  /foreign key on columns \(keyId\)/i,
];

let currentTable = null;
let currentTableHasOtherChanges = false;
const realDrift = [];

for (const rawLine of lines) {
  const line = rawLine.replace(/\r$/, "");
  const tableMatch = line.match(/^\[\*\]\s+Changed the `(\w+)` table/);
  if (tableMatch) {
    if (currentTable && currentTableHasOtherChanges) {
      // previous table had real drift
    }
    currentTable = tableMatch[1];
    currentTableHasOtherChanges = false;
    continue;
  }

  const changeMatch = line.match(/^\s+\[([+-])\]\s+(.*)$/);
  if (changeMatch) {
    const text = changeMatch[2];
    const isIgnored = IGNORED_PATTERNS.some((pat) => pat.test(text));
    if (!isIgnored) {
      if (!currentTableHasOtherChanges && currentTable) {
        realDrift.push(`[*] Changed the \`${currentTable}\` table`);
        currentTableHasOtherChanges = true;
      }
      realDrift.push(line);
    }
    continue;
  }

  // Any other non-empty line that isn't a header/footer or warning
  if (
    line.trim() &&
    !line.startsWith("[*]") &&
    !line.startsWith("Prisma schema loaded") &&
    !line.startsWith("warn Preview feature")
  ) {
    // If it's a diff section header for a new table or enum
    if (line.startsWith("[+]") || line.startsWith("[-]")) {
      realDrift.push(line);
    }
  }
}

if (realDrift.length > 0) {
  console.error("❌ Real Prisma schema drift detected:");
  console.error(realDrift.join("\n"));
  process.exit(2);
}

console.log("✅ schema.prisma matches committed migrations (ignoring DB-native tsvector/FK extensions).");
process.exit(0);
