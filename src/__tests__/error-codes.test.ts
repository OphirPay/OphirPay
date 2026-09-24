/**
 * Test that the TypeScript error catalog stays in sync with the Rust
 * `ContractError` enum. The test runs the generation script and compares
 * the output to the committed `src/lib/contract-errors.ts`. If they differ,
 * the test fails with a clear instruction to regenerate the file.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const scriptPath = path.resolve(__dirname, '../../scripts/generate-contract-errors.ts');
const generatedPath = path.resolve(__dirname, '../../src/lib/contract-errors.generated.ts');
const targetPath = path.resolve(__dirname, '../../src/lib/contract-errors.ts');

test('TypeScript contract error catalog is up to date with Rust enum', () => {
  // Run the generation script
  execSync(`ts-node ${scriptPath}`, { stdio: 'inherit' });

  const generated = fs.readFileSync(generatedPath, 'utf8').trim();
  const target = fs.readFileSync(targetPath, 'utf8').trim();

  expect(generated).toBe(target);
});
