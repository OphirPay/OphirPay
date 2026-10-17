// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveCronTargetConfig,
  runCronSweep,
} from "../../scripts/run-cron-sweep.mjs";

const VERCEL_JSON_PATH = path.resolve(process.cwd(), "vercel.json");

describe("Staging deployment & parameterized cron sweep (#1328)", () => {
  it("enables both main and integration/staging deployments and cron schedules in vercel.json", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(VERCEL_JSON_PATH, "utf8"));
    expect(vercelConfig.git?.deploymentEnabled?.main).toBe(true);
    expect(vercelConfig.git?.deploymentEnabled?.["integration/staging"]).toBe(
      true
    );
    expect(vercelConfig.crons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/cron" }),
        expect.objectContaining({ path: "/api/requests/expire" }),
      ])
    );
  });

  it("resolves staging and production cron URLs and secrets from environment variables without hard-coded hosts", () => {
    const env = {
      STAGING_CRON_BASE_URL: "https://ophirpay-staging.vercel.app/",
      STAGING_CRON_SECRET: "staging-secret-123",
      PRODUCTION_CRON_BASE_URL: "https://ophirpay.vercel.app",
      PRODUCTION_CRON_SECRET: "prod-secret-456",
    };

    const staging = resolveCronTargetConfig("staging", env);
    expect(staging.baseUrl).toBe("https://ophirpay-staging.vercel.app");
    expect(staging.secret).toBe("staging-secret-123");
    expect(staging.urls).toEqual([
      "https://ophirpay-staging.vercel.app/api/cron",
      "https://ophirpay-staging.vercel.app/api/requests/expire",
    ]);

    const prod = resolveCronTargetConfig("production", env);
    expect(prod.baseUrl).toBe("https://ophirpay.vercel.app");
    expect(prod.secret).toBe("prod-secret-456");
  });

  it("executes cron sweep against staging using staging-scoped bearer credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });

    const results = await runCronSweep("staging", {
      env: {
        STAGING_CRON_BASE_URL: "https://staging.ophirpay.com",
        STAGING_CRON_SECRET: "sec_stg_999",
      },
      fetchImpl: fetchMock,
    });

    expect(results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://staging.ophirpay.com/api/cron",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sec_stg_999",
        }),
      })
    );
  });
});
