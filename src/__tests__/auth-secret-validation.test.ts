// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  validateAuthSecret,
  isPlaceholderAuthSecret,
  DISALLOWED_AUTH_SECRET_PATTERNS,
} from "@/lib/env";
import { getAuthSecret } from "@/lib/auth-session";
import { bootstrap } from "@/lib/startup";

vi.mock("@/lib/prisma", () => ({
  default: {},
  prisma: {},
}));

vi.mock("@/lib/rate-limit", () => ({
  initRateLimitStore: vi.fn().mockResolvedValue(undefined),
}));

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "validate-deploy-config.sh");

const VALID_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SHORT_SECRET = "too-short-secret-123";
const PLACEHOLDER_SECRET = "replace-with-openssl-rand-hex-32-output";

describe("AUTH_SECRET Validation (Issue #705)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("isPlaceholderAuthSecret", () => {
    it("identifies known default and placeholder patterns", () => {
      for (const pattern of DISALLOWED_AUTH_SECRET_PATTERNS) {
        expect(isPlaceholderAuthSecret(pattern)).toBe(true);
      }
      expect(isPlaceholderAuthSecret("REPLACE-WITH-OPENSSL-RAND-HEX-32-OUTPUT")).toBe(true);
      expect(isPlaceholderAuthSecret("my-placeholder-secret-that-is-long-enough-32-chars")).toBe(true);
      expect(isPlaceholderAuthSecret("please-changeme-before-deploying-to-production")).toBe(true);
    });

    it("returns false for legitimate cryptographic secrets", () => {
      expect(isPlaceholderAuthSecret(VALID_SECRET)).toBe(false);
      expect(isPlaceholderAuthSecret("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toBe(false);
      expect(isPlaceholderAuthSecret("wE8+VzN8n23L+0o3G7yE8v0lE8q2t5u0O8r4t8u2w4y=")).toBe(false);
    });
  });

  describe("validateAuthSecret", () => {
    it("rejects missing, empty, or whitespace secrets in production", () => {
      expect(validateAuthSecret(undefined, true).valid).toBe(false);
      expect(validateAuthSecret("", true).valid).toBe(false);
      expect(validateAuthSecret("   ", true).valid).toBe(false);
      expect(validateAuthSecret(undefined, true).error).toContain("AUTH_SECRET is required in production");
    });

    it("rejects secrets shorter than 32 characters in production", () => {
      const res = validateAuthSecret(SHORT_SECRET, true);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("too short");
      expect(res.error).toContain("minimum of 32 characters");
    });

    it("rejects placeholder secrets in production even if length >= 32", () => {
      const res = validateAuthSecret(PLACEHOLDER_SECRET, true);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("placeholder or example value");
    });

    it("accepts valid secrets with >= 32 characters in production", () => {
      expect(validateAuthSecret(VALID_SECRET, true).valid).toBe(true);
    });

    it("allows unset or placeholder secrets in non-production environments", () => {
      expect(validateAuthSecret(undefined, false).valid).toBe(true);
      expect(validateAuthSecret(PLACEHOLDER_SECRET, false).valid).toBe(true);
    });
  });

  describe("getAuthSecret", () => {
    it("returns the configured valid secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.AUTH_SECRET = VALID_SECRET;
      expect(getAuthSecret()).toBe(VALID_SECRET);
    });

    it("throws an actionable error in production when AUTH_SECRET is placeholder", () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.AUTH_SECRET = PLACEHOLDER_SECRET;
      expect(() => getAuthSecret()).toThrow(/placeholder or example value/i);
    });

    it("throws an actionable error in production when AUTH_SECRET is short", () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.AUTH_SECRET = SHORT_SECRET;
      expect(() => getAuthSecret()).toThrow(/too short/i);
    });

    it("throws an actionable error in production when AUTH_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
      delete process.env.AUTH_SECRET;
      expect(() => getAuthSecret()).toThrow(/AUTH_SECRET is required in production/i);
    });

    it("falls back to dev secret in development when AUTH_SECRET is missing or placeholder", () => {
      vi.stubEnv("NODE_ENV", "development");
      delete process.env.AUTH_SECRET;
      expect(getAuthSecret()).toContain("dev-only-auth-secret");

      process.env.AUTH_SECRET = PLACEHOLDER_SECRET;
      expect(getAuthSecret()).toContain("dev-only-auth-secret");
    });
  });

  describe("bootstrap startup guard", () => {
    it("fails production startup and calls process.exit when AUTH_SECRET is placeholder", async () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.DATABASE_URL = "postgresql://localhost:5432/test";
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
      process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
      process.env.AUTH_SECRET = PLACEHOLDER_SECRET;

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await expect(bootstrap()).rejects.toThrow(/placeholder or example value/i);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("fails production startup and calls process.exit when AUTH_SECRET is too short", async () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.DATABASE_URL = "postgresql://localhost:5432/test";
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
      process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
      process.env.AUTH_SECRET = SHORT_SECRET;

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await expect(bootstrap()).rejects.toThrow(/too short/i);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("boots successfully in production when AUTH_SECRET is valid", async () => {
    vi.stubEnv("NODE_ENV", "production");
      process.env.DATABASE_URL = "postgresql://localhost:5432/test";
      process.env.DIRECT_DATABASE_URL = "postgresql://localhost:5432/test";
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
      process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
      process.env.AUTH_SECRET = VALID_SECRET;

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await expect(bootstrap()).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("scripts/validate-deploy-config.sh security guard", () => {
    it("fails when AUTH_SECRET is set to the placeholder value", () => {
      expect(() => {
        execFileSync("bash", [SCRIPT], {
          env: {
            ...process.env,
            AUTH_SECRET: PLACEHOLDER_SECRET,
          },
          stdio: "pipe",
        });
      }).toThrow();
    });

    it("fails when AUTH_SECRET is shorter than 32 characters", () => {
      expect(() => {
        execFileSync("bash", [SCRIPT], {
          env: {
            ...process.env,
            AUTH_SECRET: SHORT_SECRET,
          },
          stdio: "pipe",
        });
      }).toThrow();
    });

    it("passes when AUTH_SECRET is a valid 32+ character secret", () => {
      const output = execFileSync("bash", [SCRIPT], {
        env: {
          ...process.env,
          AUTH_SECRET: VALID_SECRET,
        },
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(output).toContain("AUTH_SECRET is valid and has sufficient length");
    });
  });
});
