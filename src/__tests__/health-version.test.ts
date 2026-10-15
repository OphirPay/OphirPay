// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1339: Health endpoints report a hard-coded version, so staging
 * cannot confirm which build is live.
 *
 * Validates dynamic resolution of application version and commit SHA
 * in app-version helper and across /api/health and /api/health/live.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAppVersion, getCommitSha } from "@/lib/app-version";
import { GET as getLiveHealth } from "@/app/api/health/live/route";

// Mock prisma for /api/health
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock contracts for /api/health
vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import prisma from "@/lib/prisma";
import { GET as getHealth } from "@/app/api/health/route";

describe("app-version helper (issue #1339)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getAppVersion", () => {
    it("returns NEXT_PUBLIC_APP_VERSION when set", () => {
      process.env.NEXT_PUBLIC_APP_VERSION = "2.4.1";
      expect(getAppVersion()).toBe("2.4.1");
    });

    it("falls back to package.json version when env var is unset", () => {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
      expect(getAppVersion()).toBe("0.1.0");
    });
  });

  describe("getCommitSha", () => {
    it("returns short SHA when GIT_SHA is set", () => {
      process.env.GIT_SHA = "abcdef1234567890abcdef1234567890abcdef12";
      expect(getCommitSha()).toBe("abcdef1");
    });

    it("returns short SHA when VERCEL_GIT_COMMIT_SHA is set", () => {
      delete process.env.GIT_SHA;
      process.env.VERCEL_GIT_COMMIT_SHA = "fedcba9876543210fedcba9876543210fedcba98";
      expect(getCommitSha()).toBe("fedcba9");
    });

    it("returns short SHA when NEXT_PUBLIC_COMMIT_SHA is set", () => {
      delete process.env.GIT_SHA;
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      process.env.NEXT_PUBLIC_COMMIT_SHA = "9876543210fedcba9876543210fedcba98abcdef";
      expect(getCommitSha()).toBe("9876543");
    });

    it("returns 'dev' when no git SHA env var is present", () => {
      delete process.env.GIT_SHA;
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      delete process.env.NEXT_PUBLIC_COMMIT_SHA;
      expect(getCommitSha()).toBe("dev");
    });

    it("returns 'dev' when git SHA env var is 'dev'", () => {
      process.env.GIT_SHA = "dev";
      expect(getCommitSha()).toBe("dev");
    });
  });
});

describe("GET /api/health/live dynamic versioning (issue #1339)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("exposes dynamic version and commit sha in liveness probe response", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.5.0";
    process.env.GIT_SHA = "1234567890abcdef";

    const res = await getLiveHealth();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.version).toBe("1.5.0");
    expect(body.data.commit).toBe("1234567");
    expect(body.data.probe).toBe("liveness");
  });
});

describe("GET /api/health dynamic versioning (issue #1339)", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("exposes dynamic version and commit sha in readiness response", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.8.2";
    process.env.GIT_SHA = "a1b2c3d4e5f6";

    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await getHealth(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.version).toBe("1.8.2");
    expect(body.data.commit).toBe("a1b2c3d");
  });
});
