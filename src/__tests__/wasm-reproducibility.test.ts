import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

describe("Soroban CLI Setup & WASM Reproducibility Verification (#1418)", () => {
  it("pins Rust 1.91.0 and WASM targets in contracts/rust-toolchain.toml", () => {
    const toolchainPath = path.join(ROOT, "contracts", "rust-toolchain.toml");
    expect(fs.existsSync(toolchainPath)).toBe(true);
    const content = fs.readFileSync(toolchainPath, "utf8");
    expect(content).toContain('channel = "1.91.0"');
    expect(content).toContain("wasm32-unknown-unknown");
    expect(content).toContain("wasm32v1-none");
  });

  it("maintains valid SHA-256 checksums in contracts/expected-wasm-hashes.sha256", () => {
    const hashFilePath = path.join(ROOT, "contracts", "expected-wasm-hashes.sha256");
    expect(fs.existsSync(hashFilePath)).toBe(true);
    const lines = fs
      .readFileSync(hashFilePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const parsed = lines.map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      expect(match).not.toBeNull();
      return { sha256: match![1], artifact: match![2] };
    });

    const artifacts = parsed.map((p) => p.artifact);
    expect(artifacts).toContain(
      "contracts/ophirpay/target/wasm32v1-none/release/ophirpay_contract.wasm"
    );
    expect(artifacts).toContain(
      "contracts/emitter/target/wasm32v1-none/release/ophirpay_emitter.wasm"
    );
  });

  it("provides scripts/setup-soroban-env.sh for pinned Rust, WASM targets, and stellar-cli", () => {
    const scriptPath = path.join(ROOT, "scripts", "setup-soroban-env.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("contracts/rust-toolchain.toml");
    expect(script).toContain("wasm32-unknown-unknown");
    expect(script).toContain("wasm32v1-none");
    expect(script).toContain("stellar-cli");
    expect(script).toContain("--verify");
    expect(script).toContain("--dry-run");
    expect(script).toContain("--print-config");
  });

  it("enforces deterministic compiler flags and SHA-256 verification in scripts/verify-wasm-reproducibility.sh", () => {
    const scriptPath = path.join(ROOT, "scripts", "verify-wasm-reproducibility.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf8");
    expect(script).toContain("contracts/expected-wasm-hashes.sha256");
    expect(script).toContain("-C opt-level=z");
    expect(script).toContain("-C link-arg=-s");
    expect(script).toContain("--remap-path-prefix=");
    expect(script).toContain("cargo build --locked --target \"$TARGET\" --release");
    expect(script).toContain("sha256sum -c");
    expect(script).toContain("./scripts/setup-soroban-env.sh");
    expect(script).toContain("./scripts/verify-wasm-reproducibility.sh --update");
  });

  it("documents Soroban CLI setup and WASM reproducibility in docs/LOCAL_DEV.md", () => {
    const docPath = path.join(ROOT, "docs", "LOCAL_DEV.md");
    const doc = fs.readFileSync(docPath, "utf8");
    expect(doc).toContain("./scripts/setup-soroban-env.sh");
    expect(doc).toContain("./scripts/verify-wasm-reproducibility.sh");
    expect(doc).toContain("contracts/expected-wasm-hashes.sha256");
  });
});
