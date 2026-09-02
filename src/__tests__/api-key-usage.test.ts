// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { aggregateApiKeyUsage, type ApiKeyUsageInput } from "@/lib/api-key-usage";

const key = (id: string): ApiKeyUsageInput => ({
  id, name: id, prefix: `oph_${id}`, lastUsed: null,
  createdAt: new Date("2026-08-01T00:00:00Z"), expiresAt: null,
});

describe("aggregateApiKeyUsage", () => {
  it("counts each key overall and inside the requested window", () => {
    const since = new Date("2026-08-20T00:00:00Z");
    const result = aggregateApiKeyUsage([key("one"), key("two")], [
      { keyId: "one", createdAt: new Date("2026-08-19T23:59:59Z") },
      { keyId: "one", createdAt: new Date("2026-08-20T00:00:00Z") },
      { keyId: "one", createdAt: new Date("2026-08-21T00:00:00Z") },
      { keyId: "two", createdAt: new Date("2026-08-22T00:00:00Z") },
    ], since);

    expect(result).toMatchObject([
      { id: "one", total: 3, window: 2 },
      { id: "two", total: 1, window: 1 },
    ]);
  });

  it("keeps keys with no requests visible", () => {
    expect(aggregateApiKeyUsage([key("unused")], [], new Date())).toMatchObject([
      { id: "unused", total: 0, window: 0 },
    ]);
  });
});