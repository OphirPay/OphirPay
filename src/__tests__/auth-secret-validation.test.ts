// SPDX-License-Identifier: MIT
//
// Issue #705 — AUTH_SECRET must not be accepted with placeholder or weak
// values at startup. Covers the shared validator, the production fast-fail in
// `validateEnv`, the session-signing path, and the deploy-time guard in
// `scripts/validate-deploy-config.sh`.

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  AUTH_SECRET_MIN_BYTES,
  AUTH_SECRET_PLACEHOLDER,
  authSecretProblem,
  assertAuthSecret,
  validateEnv,
} from "@/lib/env";
import { getAuthSecret } from "@/lib/auth-session";

// A real `openssl rand -hex 32` value (64 hex chars).
const STRONG_SECRET =
  "9f2c7a41d8b3e6501a2c4e6f8b0d2a4c6e8f0b2d4a6c8e0f2b4d6a8c0e2f4b6d";

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://localhost:5432/ophirpay",
  NEXT_PUBLIC_CONTRACT_ID:
    "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
  NEXT_PUBLIC_EMITTER_CONTRACT_ID:
    "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
};

const DEPLOY_CONFIG_SCRIPT = path.resolve(
  process.cwd(),
  "scripts/validate-deploy-config.sh"
);

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("authSecretProblem", () => {
  it("accepts a 64-hex CSPRNG secret", () => {
    expect(authSecretProblem(STRONG_SECRET)).toBeNull();
  });

  it("rejects missing, empty, and whitespace-only values", () => {
    expect(authSecretProblem(undefined)).toContain("not set");
    expect(authSecretProblem(null)).toContain("not set");
    expect(authSecretProblem("")).toContain("not set");
    expect(authSecretProblem("   ")).toContain("not set");
  });

  it("rejects the .env.example placeholder and its obvious variants", () => {
    expect(authSecretProblem(AUTH_SECRET_PLACEHOLDER)).toContain("placeholder");
    expect(
      authSecretProblem(AUTH_SECRET_PLACEHOLDER.toUpperCase())
    ).toContain("placeholder");
    expect(authSecretProblem("changeme-changeme-changeme-changeme")).toContain(
      "placeholder"
    );
    expect(
      authSecretProblem("my-own-insecure-secret-value-for-this-app")
    ).toContain("placeholder");
    expect(
      authSecretProblem("PLACEHOLDER-VALUE-THAT-IS-LONG-ENOUGH-1234")
    ).toContain("placeholder");
  });

  it("rejects values shorter than the 32-byte minimum", () => {
    const problem = authSecretProblem("short");
    expect(problem).toContain(String(AUTH_SECRET_MIN_BYTES));
  });

  it("rejects a single repeated character", () => {
    expect(authSecretProblem("a".repeat(40))).toContain("repeated");
  });

  it("measures byte length, not JavaScript code units", () => {
    // 22 code units (`é` is two UTF-8 bytes) = 33 bytes — long enough in
    // bytes even though the string is shorter than 32 characters.
    const multibyte = "éa".repeat(11);
    expect(multibyte.length).toBeLessThan(AUTH_SECRET_MIN_BYTES);
    expect(new TextEncoder().encode(multibyte).length).toBeGreaterThanOrEqual(
      AUTH_SECRET_MIN_BYTES
    );
    expect(authSecretProblem(multibyte)).toBeNull();
  });
});

describe("assertAuthSecret", () => {
  it("returns the trimmed secret when valid", () => {
    expect(assertAuthSecret(`  ${STRONG_SECRET}  `)).toBe(STRONG_SECRET);
  });

  it("names the variable and the generation command", () => {
    let message = "";
    try {
      assertAuthSecret(AUTH_SECRET_PLACEHOLDER);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("AUTH_SECRET");
    expect(message).toContain("openssl rand -hex 32");
  });
});

describe("validateEnv in production", () => {
  function setProductionEnv(extra: Record<string, string | undefined>) {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...extra })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  it("throws on the placeholder with an actionable message", () => {
    setProductionEnv({ AUTH_SECRET: AUTH_SECRET_PLACEHOLDER });
    expect(() => validateEnv()).toThrow(/AUTH_SECRET is required in production/);
    expect(() => validateEnv()).toThrow(/openssl rand -hex 32/);
  });

  it("throws when AUTH_SECRET is absent", () => {
    setProductionEnv({ AUTH_SECRET: undefined });
    expect(() => validateEnv()).toThrow(/AUTH_SECRET is required in production/);
  });

  it("throws when AUTH_SECRET is too short", () => {
    setProductionEnv({ AUTH_SECRET: "short-secret" });
    expect(() => validateEnv()).toThrow(/AUTH_SECRET is required in production/);
  });

  it("boots with a strong secret", () => {
    setProductionEnv({ AUTH_SECRET: STRONG_SECRET });
    const env = validateEnv();
    expect(env.NODE_ENV).toBe("production");
    expect(env.AUTH_SECRET).toBe(STRONG_SECRET);
  });

  it("still reports missing required variables before the secret check", () => {
    setProductionEnv({ DATABASE_URL: undefined, AUTH_SECRET: STRONG_SECRET });
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });
});

describe("getAuthSecret on the signing path", () => {
  it("refuses to sign with the placeholder in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.AUTH_SECRET = AUTH_SECRET_PLACEHOLDER;
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET is required in production/);
  });

  it("returns a strong secret in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.AUTH_SECRET = STRONG_SECRET;
    expect(getAuthSecret()).toBe(STRONG_SECRET);
  });
});

describe("scripts/validate-deploy-config.sh AUTH_SECRET guard", () => {
  function run(secret?: string) {
    const env = { ...process.env };
    if (secret === undefined) delete env.AUTH_SECRET;
    else env.AUTH_SECRET = secret;
    return spawnSync("bash", [DEPLOY_CONFIG_SCRIPT], { env, encoding: "utf8" });
  }

  it("passes with a strong secret", () => {
    const res = run(STRONG_SECRET);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("AUTH_SECRET length OK");
  });

  it("passes when AUTH_SECRET is not set (CI deploy-config job)", () => {
    const res = run(undefined);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("AUTH_SECRET not set");
  });

  it("fails on the placeholder", () => {
    const res = run(AUTH_SECRET_PLACEHOLDER);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("looks like a placeholder");
  });

  it("fails on a short value", () => {
    const res = run("short");
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("shorter than 32 bytes");
  });
});
