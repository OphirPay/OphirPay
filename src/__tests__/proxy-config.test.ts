// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  buildCsp,
  CSP_POLICY,
  generateRequestId,
  getClientIp,
  getRateLimitMax,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/proxy-config";

function directive(csp: string, name: string): string[] {
  const value = csp.split("; ").find((entry) => entry.startsWith(`${name} `));
  return value?.split(" ").slice(1) ?? [];
}

describe("proxy configuration", () => {
  it("keeps the API rate-limit window and default configurable", () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(getRateLimitMax("")).toBe(120);
    expect(getRateLimitMax("45")).toBe(45);
    expect(getRateLimitMax("invalid")).toBe(120);
    expect(getRateLimitMax("0")).toBe(120);
    expect(getRateLimitMax("-5")).toBe(1);
  });

  it("uses the first forwarded IP, then the real IP, then unknown", () => {
    expect(
      getClientIp(
        new Headers({
          "x-forwarded-for": " 203.0.113.5, 198.51.100.2",
          "x-real-ip": "192.0.2.1",
        })
      )
    ).toBe("203.0.113.5");
    expect(getClientIp(new Headers({ "x-real-ip": "192.0.2.1" }))).toBe(
      "192.0.2.1"
    );
    expect(getClientIp(new Headers())).toBe("unknown");
  });

  it("keeps request IDs in the existing timestamp/random format", () => {
    const random = 0.123456789;
    expect(generateRequestId(36, random)).toBe(
      `req_10_${random.toString(36).slice(2, 8)}`
    );
  });

  it("keeps the CSP endpoint whitelist reviewable and environment-specific", () => {
    const production = buildCsp(true);
    const development = buildCsp(false);

    expect(directive(production, "connect-src")).toEqual(CSP_POLICY.connectSrc);
    expect(directive(production, "script-src")).toEqual(
      CSP_POLICY.scriptSrc.production
    );
    expect(directive(development, "script-src")).toEqual(
      CSP_POLICY.scriptSrc.development
    );
    expect(directive(production, "script-src")).not.toContain("'unsafe-eval'");
    expect(production).toContain(`report-to ${CSP_POLICY.reportingGroup}`);
    expect(production).toContain(`report-uri ${CSP_POLICY.reportUri}`);
  });
});
