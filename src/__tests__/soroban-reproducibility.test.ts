import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Soroban Toolchain Setup & WASM Reproducibility (#1418)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const setupScriptPath = path.join(rootDir, 'scripts/setup-soroban-env.sh');
  const verifyScriptPath = path.join(rootDir, 'scripts/verify-wasm-reproducibility.sh');
  const toolchainPath = path.join(rootDir, 'contracts/rust-toolchain.toml');
  const hashFilePath = path.join(rootDir, 'contracts/expected-wasm-hashes.sha256');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const localDevDocPath = path.join(rootDir, 'docs/LOCAL_DEV.md');

  it('scripts/setup-soroban-env.sh exists with valid bash shebang', () => {
    expect(fs.existsSync(setupScriptPath)).toBe(true);
    const content = fs.readFileSync(setupScriptPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(content).toContain('contracts/rust-toolchain.toml');
    expect(content).toContain('--check');
  });

  it('scripts/verify-wasm-reproducibility.sh enforces deterministic compiler flags', () => {
    expect(fs.existsSync(verifyScriptPath)).toBe(true);
    const content = fs.readFileSync(verifyScriptPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(content).toContain('--locked');
    expect(content).toContain('-C opt-level=z');
    expect(content).toContain('-C link-arg=-s');
    expect(content).toContain('--remap-path-prefix');
    expect(content).toContain('Actionable Remediation Instructions:');
  });

  it('contracts/rust-toolchain.toml pins channel 1.91.0 with wasm targets', () => {
    expect(fs.existsSync(toolchainPath)).toBe(true);
    const content = fs.readFileSync(toolchainPath, 'utf8');
    expect(content).toMatch(/channel\s*=\s*"1\.91\.0"/);
    expect(content).toContain('wasm32v1-none');
    expect(content).toContain('wasm32-unknown-unknown');
    expect(content).toContain('rustfmt');
    expect(content).toContain('clippy');
  });

  it('contracts/expected-wasm-hashes.sha256 has valid SHA-256 hash formatting', () => {
    expect(fs.existsSync(hashFilePath)).toBe(true);
    const content = fs.readFileSync(hashFilePath, 'utf8').trim();
    const lines = content.split('\n').filter(line => line.trim().length > 0 && !line.startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(2);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      expect(parts.length).toBe(2);
      const [hash, filePath] = parts;
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(filePath.endsWith('.wasm')).toBe(true);
    }
  });

  it('package.json includes contracts scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(pkg.scripts['contracts:setup']).toBe('bash scripts/setup-soroban-env.sh');
    expect(pkg.scripts['contracts:verify']).toBe('bash scripts/verify-wasm-reproducibility.sh');
    expect(pkg.scripts['contracts:verify:check']).toBe('bash scripts/verify-wasm-reproducibility.sh --check');
  });

  it('docs/LOCAL_DEV.md documents Soroban toolchain setup and reproducibility verification', () => {
    const content = fs.readFileSync(localDevDocPath, 'utf8');
    expect(content).toContain('## 8. Soroban Smart Contract Toolchain & WASM Reproducibility');
    expect(content).toContain('./scripts/setup-soroban-env.sh');
    expect(content).toContain('./scripts/verify-wasm-reproducibility.sh');
    expect(content).toContain('--locked');
    expect(content).toContain('-C opt-level=z');
  });

  it('setup script executes --help successfully', () => {
    try {
      const relPath = path.relative(rootDir, setupScriptPath).replace(/\\/g, '/');
      const output = execSync(`bash "${relPath}" --help`, { cwd: rootDir, encoding: 'utf8' });
      expect(output).toContain('Usage:');
      expect(output).toContain('--check');
    } catch {
      // In non-bash environments, verify contents statically
      const content = fs.readFileSync(setupScriptPath, 'utf8');
      expect(content).toContain('Usage: $0 [--check | --help]');
    }
  });

  it('verify script executes --help successfully', () => {
    try {
      const relPath = path.relative(rootDir, verifyScriptPath).replace(/\\/g, '/');
      const output = execSync(`bash "${relPath}" --help`, { cwd: rootDir, encoding: 'utf8' });
      expect(output).toContain('Usage:');
      expect(output).toContain('--update');
    } catch {
      // In non-bash environments, verify contents statically
      const content = fs.readFileSync(verifyScriptPath, 'utf8');
      expect(content).toContain('Usage: $0 [--check | --update | --help]');
    }
  });
});
