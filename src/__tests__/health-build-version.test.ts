// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getLive } from "@/app/api/health/live/route";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Health endpoints build version & commit metadata (#1339)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    delete process.env.GIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.NEXT_PUBLIC_GIT_SHA;
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("removes hardcoded '0.1.0' literals from health route sources", () => {
    const healthRouteSource = read("src/app/api/health/route.ts");
    const liveRouteSource = read("src/app/api/health/live/route.ts");

    expect(healthRouteSource).not.toContain('"0.1.0"');
    expect(liveRouteSource).not.toContain('"0.1.0"');
  });

  it("reports version from package.json and commit='unknown' when build env vars are unset", async () => {
    const liveRes = await getLive();
    const liveBody = await liveRes.json();
    expect(liveBody.data.version).toBe(pkg.version);
    expect(liveBody.data.commit).toBe("unknown");

    const healthRes = await getHealth(new Request("http://localhost/api/health"));
    const healthBody = await healthRes.json();
    expect(healthBody.data.version).toBe(pkg.version);
    expect(healthBody.data.commit).toBe("unknown");
  });

  it("reports custom NEXT_PUBLIC_APP_VERSION and GIT_SHA / VERCEL_GIT_COMMIT_SHA in both /api/health and /api/health/live", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2-staging";
    process.env.GIT_SHA = "9a7041ea1b2c3d4";

    const liveRes = await getLive();
    const liveBody = await liveRes.json();
    expect(liveBody.data.version).toBe("1.4.2-staging");
    expect(liveBody.data.commit).toBe("9a7041ea1b2c3d4");

    const healthRes = await getHealth(new Request("http://localhost/api/health"));
    const healthBody = await healthRes.json();
    expect(healthBody.data.version).toBe("1.4.2-staging");
    expect(healthBody.data.commit).toBe("9a7041ea1b2c3d4");

    // Verify fallback to VERCEL_GIT_COMMIT_SHA when GIT_SHA is unset
    delete process.env.GIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234def5678";
    const vercelLiveBody = await (await getLive()).json();
    expect(vercelLiveBody.data.commit).toBe("abc1234def5678");
  });

  it("declares ARG GIT_SHA and ENV GIT_SHA=$GIT_SHA in Dockerfile", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/ARG\s+GIT_SHA/);
    expect(dockerfile).toMatch(/ENV\s+GIT_SHA=\$GIT_SHA/);
  });
});
