// SPDX-License-Identifier: MIT
/**
 * Parameterized cron sweep runner for `{production, staging}` environments (#1328).
 *
 * Replaces hard-coded production URLs by reading environment-scoped base URLs
 * and `CRON_SECRET` credentials (`CRON_BASE_URL` / `STAGING_CRON_BASE_URL` and
 * `CRON_SECRET` / `STAGING_CRON_SECRET`), exercising both `/api/cron` and
 * `/api/requests/expire`.
 */

export const SUPPORTED_CRON_TARGETS = ["production", "staging"];
export const CRON_ENDPOINTS = ["/api/cron", "/api/requests/expire"];

export function resolveCronTargetConfig(target, env = process.env) {
  if (!SUPPORTED_CRON_TARGETS.includes(target)) {
    throw new Error(
      `Unsupported cron target "${target}". Expected one of: ${SUPPORTED_CRON_TARGETS.join(", ")}`
    );
  }

  const isStaging = target === "staging";
  const rawBaseUrl = isStaging
    ? env.STAGING_CRON_BASE_URL || env.CRON_BASE_URL
    : env.PRODUCTION_CRON_BASE_URL || env.CRON_BASE_URL;
  const secret = isStaging
    ? env.STAGING_CRON_SECRET || env.CRON_SECRET
    : env.PRODUCTION_CRON_SECRET || env.CRON_SECRET;

  if (!rawBaseUrl || !rawBaseUrl.trim()) {
    throw new Error(
      `Missing base URL for target "${target}". Set ${
        isStaging ? "STAGING_CRON_BASE_URL" : "PRODUCTION_CRON_BASE_URL"
      } or CRON_BASE_URL.`
    );
  }

  if (!secret || !secret.trim()) {
    throw new Error(
      `Missing CRON_SECRET for target "${target}". Set ${
        isStaging ? "STAGING_CRON_SECRET" : "PRODUCTION_CRON_SECRET"
      } or CRON_SECRET.`
    );
  }

  const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  return {
    target,
    baseUrl,
    secret: secret.trim(),
    urls: CRON_ENDPOINTS.map((endpoint) => `${baseUrl}${endpoint}`),
  };
}

export async function runCronSweep(
  target,
  { env = process.env, fetchImpl = fetch } = {}
) {
  const config = resolveCronTargetConfig(target, env);
  const results = [];

  for (const url of config.urls) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Cron sweep failed for [${target}] ${url}: HTTP ${response.status} ${body}`
      );
    }

    results.push({
      target,
      url,
      status: response.status,
    });
  }

  return results;
}
