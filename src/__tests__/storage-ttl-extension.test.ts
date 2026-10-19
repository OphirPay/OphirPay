// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const STORAGE_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/storage.rs"),
  "utf-8",
);
const CONTRACT_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/src/contract.rs"),
  "utf-8",
);
const ARCHITECTURE_MD = readFileSync(
  resolve(ROOT, "docs/CONTRACT_ARCHITECTURE.md"),
  "utf-8",
);
const INTEGRATION_TESTS_RS = readFileSync(
  resolve(ROOT, "contracts/ophirpay/tests/integration_tests.rs"),
  "utf-8",
);

describe("Automatic TTL extension for active escrow and stream records (#1352)", () => {
  it("defines TTL_THRESHOLD (10_000), TTL_EXTEND_TO (50_000), and touch_record_ttl in storage.rs", () => {
    expect(STORAGE_RS).toContain("pub const TTL_THRESHOLD: u32 = 10_000;");
    expect(STORAGE_RS).toContain("pub const TTL_EXTEND_TO: u32 = 50_000;");
    expect(STORAGE_RS).toContain("pub fn touch_record_ttl");
    expect(STORAGE_RS).toContain(".extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);");
  });

  it("calls touch_record_ttl across escrow and stream read, claim, and update functions", () => {
    expect(CONTRACT_RS).toContain("touch_record_ttl(&env, &(ESCROW_KEY, count));");
    expect(CONTRACT_RS).toContain("touch_record_ttl(&env, &(ESCROW_KEY, escrow_id));");
    expect(CONTRACT_RS).toContain("touch_record_ttl(&env, &(STREAM_KEY, count));");
    expect(CONTRACT_RS).toContain("touch_record_ttl(&env, &(STREAM_KEY, stream_id));");
  });

  it("documents storage retention policy in docs/CONTRACT_ARCHITECTURE.md and tests it in integration_tests.rs", () => {
    expect(ARCHITECTURE_MD).toContain("Storage Retention & Automatic TTL Extension Policy");
    expect(ARCHITECTURE_MD).toContain("TTL_THRESHOLD = 10_000");
    expect(ARCHITECTURE_MD).toContain("TTL_EXTEND_TO = 50_000");
    expect(ARCHITECTURE_MD).toContain("touch_record_ttl");
    expect(INTEGRATION_TESTS_RS).toContain(
      "fn test_escrow_and_stream_automatic_ttl_extension_on_read_and_claim()",
    );
  });
});
