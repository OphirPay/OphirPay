// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import packageJson from "../../package.json";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock contracts
vi.mock("@/lib/contracts", () => {
  return {
    get OPHIRPAY_CONTRACT_ID() {
      return "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";
    },
  };
});

import prisma from "@/lib/prisma";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getHealthLive } from "@/app/api/health/live/route";
import { getAppVersion, getCommitSha } from "@/lib/build-info";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

describe("Health endpoints build version & commit metadata (#1339)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    delete process.env.GIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.NEXT_PUBLIC_GIT_SHA;
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns package.json version by default in both endpoints", async () => {
    expect(getAppVersion()).toBe(packageJson.version);

    const resReady = await getHealth(new Request("http://localhost/api/health"));
    const bodyReady = await resReady.json();
    expect(bodyReady.data.version).toBe(packageJson.version);
    expect(bodyReady.data.commit).toBe("development");

    const resLive = await getHealthLive();
    const bodyLive = await resLive.json();
    expect(bodyLive.data.version).toBe(packageJson.version);
    expect(bodyLive.data.commit).toBe("development");
  });

  it("truncates GIT_SHA to 7 characters and reflects in /api/health and /api/health/live", async () => {
    process.env.GIT_SHA = "9a7041e175a9f47db3cccdfcae201f557e3bdd40";

    expect(getCommitSha()).toBe("9a7041e");

    const resReady = await getHealth(new Request("http://localhost/api/health"));
    const bodyReady = await resReady.json();
    expect(bodyReady.data.commit).toBe("9a7041e");

    const resLive = await getHealthLive();
    const bodyLive = await resLive.json();
    expect(bodyLive.data.commit).toBe("9a7041e");
  });

  it("prefers VERCEL_GIT_COMMIT_SHA when available", async () => {
    process.env.GIT_SHA = "1111111aaaaaaa";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef0123456789";

    expect(getCommitSha()).toBe("abcdef0");

    const res = await getHealthLive();
    const body = await res.json();
    expect(body.data.commit).toBe("abcdef0");
  });

  it("overrides package.json version when NEXT_PUBLIC_APP_VERSION is set", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.2.0-rc.1";

    expect(getAppVersion()).toBe("0.2.0-rc.1");

    const resReady = await getHealth(new Request("http://localhost/api/health"));
    const bodyReady = await resReady.json();
    expect(bodyReady.data.version).toBe("0.2.0-rc.1");

    const resLive = await getHealthLive();
    const bodyLive = await resLive.json();
    expect(bodyLive.data.version).toBe("0.2.0-rc.1");
  });
});
