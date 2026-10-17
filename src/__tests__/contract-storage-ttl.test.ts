// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Automatic TTL extension for active escrow and stream records (#1352)", () => {
  it("defines RECORD_TTL_THRESHOLD (10_000), RECORD_TTL_EXTEND (50_000), and touch_record_ttl in storage.rs", () => {
    const storageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "contracts/ophirpay/src/storage.rs"),
      "utf8"
    );
    expect(storageSrc).toContain("pub const RECORD_TTL_THRESHOLD: u32 = 10_000;");
    expect(storageSrc).toContain("pub const RECORD_TTL_EXTEND: u32 = 50_000;");
    expect(storageSrc).toContain(
      "pub fn touch_record_ttl(env: &Env, prefix: &Symbol, id: u64)"
    );
    expect(storageSrc).toContain(
      ".extend_ttl(&key, RECORD_TTL_THRESHOLD, RECORD_TTL_EXTEND)"
    );
  });

  it("invokes touch_record_ttl on escrow and stream reads, claims, and updates in contract.rs", () => {
    const contractSrc = fs.readFileSync(
      path.resolve(process.cwd(), "contracts/ophirpay/src/contract.rs"),
      "utf8"
    );
    expect(contractSrc).toContain("touch_record_ttl(&env, &ESCROW_KEY, escrow_id);");
    expect(contractSrc).toContain("touch_record_ttl(&env, &STREAM_KEY, stream_id);");
  });

  it("documents the storage retention policy in docs/CONTRACT_ARCHITECTURE.md", () => {
    const doc = fs.readFileSync(
      path.resolve(process.cwd(), "docs/CONTRACT_ARCHITECTURE.md"),
      "utf8"
    );
    expect(doc).toContain("RECORD_TTL_THRESHOLD = 10_000");
    expect(doc).toContain("RECORD_TTL_EXTEND = 50_000");
    expect(doc).toContain("touch_record_ttl");
  });
});
