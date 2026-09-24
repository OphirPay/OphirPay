#!/usr/bin/env ts-node

/**
 * Generates a TypeScript enum from the Rust `ContractError` enum.
 *
 * The generated file is written to `src/lib/contract-errors.generated.ts`.
 * It is compared against the committed `src/lib/contract-errors.ts` in the
 * test `src/__tests__/error-codes.test.ts`. If they differ, the test will
 * fail and instruct the developer to run this script.
 *
 * This script is intentionally lightweight and only parses the enum
 * definition. It does not attempt to understand Rust attributes or
 * documentation comments.
 */

import fs from 'fs';
import path from 'path';

const rustPath = path.resolve(__dirname, '../contracts/ophirpay/src/lib.rs');
const outputPath = path.resolve(__dirname, '../src/lib/contract-errors.generated.ts');

const rustContent = fs.readFileSync(rustPath, 'utf8');

// Find the enum body
const enumMatch = rustContent.match(/pub\s+enum\s+ContractError\s*{([\s\S]*?)}/);
if (!enumMatch) {
  console.error('Could not find `ContractError` enum in contracts/ophirpay/src/lib.rs');
  process.exit(1);
}

const body = enumMatch[1];
const lines = body.split('\n');

let current = 0;
const variants: { name: string; value: number }[] = [];

// Parse each variant line
for (const line of lines) {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (trimmed.startsWith('#') || trimmed === '') {
    continue;
  }

  // Match `VariantName = 123,` or `VariantName,`
  const m = trimmed.match(/^([A-Za-z0-9_]+)\s*(?:=\s*([0-9]+))?,?$/);
  if (m) {
    const name = m[1];
    const value = m[2] !== undefined ? parseInt(m[2], 10) : current;
    variants.push({ name, value });
    current = value + 1;
  }
}

// Generate TypeScript enum
const tsContent = `// THIS FILE IS GENERATED. DO NOT EDIT MANUALLY.\n\nexport enum ContractError {\n${variants
  .map(v => `  ${v.name} = ${v.value}`)
  .join(',\n')}\n}\n`;

fs.writeFileSync(outputPath, tsContent, 'utf8');
console.log(`Generated ${outputPath}`);
