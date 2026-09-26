import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nvmrcPath = path.join(__dirname, '..', '.nvmrc');

const nvmrc = fs.readFileSync(nvmrcPath, 'utf8').trim();
const expectedMajor = parseInt(nvmrc, 10);
const currentMajor = parseInt(process.versions.node.split('.')[0], 10);

if (currentMajor !== expectedMajor) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Node version mismatch.`);
  console.error(`Expected Node major version ${expectedMajor} (from .nvmrc).`);
  console.error(`Currently running Node major version ${currentMajor}.`);
  console.error(`Please switch to Node ${expectedMajor} and try again.`);
  process.exit(1);
}
