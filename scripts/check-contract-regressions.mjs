import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const contracts = [
  ['ophirpay', join(root, 'contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm')],
  ['emitter', join(root, 'contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm')],
];
const baselinePath = join(root, 'contracts/wasm-baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const rows = [];

for (const [name, file] of contracts) {
  if (!existsSync(file)) throw new Error(`Missing release artifact: ${file}`);
  const bytes = readFileSync(file).byteLength;
  const limit = baseline[name]?.maxBytes;
  if (!Number.isInteger(limit) || bytes > limit) {
    throw new Error(`${name} WASM size ${bytes} exceeds baseline limit ${limit ?? 'unset'}`);
  }
  rows.push(`| ${name} | ${bytes} | ${limit} |`);
}

const report = ['## Contract regression report', '', '| Contract | WASM bytes | Guardrail |', '| --- | ---: | ---: |', ...rows, ''].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
