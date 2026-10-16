import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Rust CI Cache & --locked Invariants (Issue #1327)", () => {
  const ciWorkflowPath = join(process.cwd(), ".github", "workflows", "ci.yml");
  const regressionWorkflowPath = join(process.cwd(), ".github", "workflows", "contract-regression.yml");
  const ophirpayLockPath = join(process.cwd(), "contracts", "ophirpay", "Cargo.lock");
  const emitterLockPath = join(process.cwd(), "contracts", "emitter", "Cargo.lock");

  it("verifies that contract Cargo.lock files exist in repository", () => {
    expect(existsSync(ophirpayLockPath)).toBe(true);
    expect(existsSync(emitterLockPath)).toBe(true);

    const ophirLock = readFileSync(ophirpayLockPath, "utf-8");
    const emitLock = readFileSync(emitterLockPath, "utf-8");

    expect(ophirLock).toContain('name = "ophirpay-contract"');
    expect(emitLock).toContain('name = "ophirpay-emitter"');
  });

  describe("ci.yml Rust Cache & Locked Invariants", () => {
    const ciContent = readFileSync(ciWorkflowPath, "utf-8");

    it("includes Cargo.lock in ci.yml Cargo cache key", () => {
      expect(ciContent).toMatch(
        /key:\s*cargo-\${{\s*runner\.os\s*}}-\${{\s*hashFiles\('contracts\/\*\*\/Cargo\.lock',\s*'contracts\/\*\*\/Cargo\.toml'\)\s*}}/
      );
    });

    it("caches cargo registry, git, and contract targets in ci.yml", () => {
      expect(ciContent).toContain("~/.cargo/registry");
      expect(ciContent).toContain("~/.cargo/git");
      expect(ciContent).toContain("contracts/ophirpay/target");
      expect(ciContent).toContain("contracts/emitter/target");
    });

    it("enforces --locked on all cargo build invocations in ci.yml", () => {
      expect(ciContent).toMatch(/cd contracts\/ophirpay && cargo build --locked --target wasm32v1-none --release/);
      expect(ciContent).toMatch(/cd contracts\/emitter && cargo build --locked --target wasm32v1-none --release/);
    });

    it("enforces --locked on all cargo test invocations in ci.yml", () => {
      expect(ciContent).toMatch(/cd contracts\/ophirpay && PROPTEST_CASES=64 cargo test --locked/);
      expect(ciContent).toMatch(/cd contracts\/emitter && cargo test --locked/);
    });
  });

  describe("contract-regression.yml Rust Cache & Locked Invariants", () => {
    const regressionContent = readFileSync(regressionWorkflowPath, "utf-8");

    it("disables default setup-rust-toolchain internal cache to prevent conflict", () => {
      expect(regressionContent).toMatch(/actions-rust-lang\/setup-rust-toolchain@v1[\s\S]*?cache:\s*false/);
    });

    it("configures actions/cache@v4 in contract-regression.yml", () => {
      expect(regressionContent).toMatch(/name:\s*Cache Cargo[\s\S]*?uses:\s*actions\/cache@v4/);
    });

    it("includes Cargo.lock and Cargo.toml in contract-regression.yml cache key", () => {
      expect(regressionContent).toMatch(
        /key:\s*cargo-\${{\s*runner\.os\s*}}-\${{\s*hashFiles\('contracts\/\*\*\/Cargo\.lock',\s*'contracts\/\*\*\/Cargo\.toml'\)\s*}}/
      );
    });

    it("caches cargo registry, git, and contract targets in contract-regression.yml", () => {
      expect(regressionContent).toContain("~/.cargo/registry");
      expect(regressionContent).toContain("~/.cargo/git");
      expect(regressionContent).toContain("contracts/ophirpay/target");
      expect(regressionContent).toContain("contracts/emitter/target");
    });

    it("enforces --locked on cargo build commands in contract-regression.yml", () => {
      expect(regressionContent).toMatch(
        /cargo build --locked --manifest-path ophirpay\/Cargo\.toml --target wasm32v1-none --release/
      );
      expect(regressionContent).toMatch(
        /cargo build --locked --manifest-path emitter\/Cargo\.toml --target wasm32v1-none --release/
      );
    });

    it("enforces --locked on cargo test fee_report in contract-regression.yml", () => {
      expect(regressionContent).toMatch(
        /cargo test --locked --manifest-path ophirpay\/Cargo\.toml --test fee_report -- --nocapture/
      );
    });
  });
});
