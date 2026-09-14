// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import type { OnChainPayment } from "@/lib/contracts";
import {
  applyPaymentSort,
  getNextSort,
  getPaymentStatus,
  getSortParamUpdates,
  parsePaymentSort,
} from "@/lib/payments-sort";

function payment(overrides: Partial<OnChainPayment>): OnChainPayment {
  return {
    id: 1,
    payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    amountStroops: 100,
    txHash: "a".repeat(64),
    timestamp: 1000,
    ...overrides,
  };
}

const PAYMENTS: OnChainPayment[] = [
  payment({ id: 1, amountStroops: 300, timestamp: 3000, metadata: "RECORDED" }),
  payment({ id: 2, amountStroops: 100, timestamp: 1000, metadata: "CANCELLED" }),
  payment({ id: 3, amountStroops: 200, timestamp: 2000, metadata: undefined }),
];

describe("getPaymentStatus", () => {
  it("derives CANCELLED from the metadata marker", () => {
    expect(getPaymentStatus({ metadata: "CANCELLED" })).toBe("CANCELLED");
  });

  it("defaults to RECORDED", () => {
    expect(getPaymentStatus({ metadata: undefined })).toBe("RECORDED");
    expect(getPaymentStatus({ metadata: "anything-else" })).toBe("RECORDED");
  });
});

describe("parsePaymentSort", () => {
  it("returns the default (no sort) when params are absent", () => {
    expect(parsePaymentSort(new URLSearchParams(""))).toEqual({
      key: null,
      dir: "asc",
    });
  });

  it("parses a valid sort + dir", () => {
    expect(
      parsePaymentSort(new URLSearchParams("sort=amount&dir=desc"))
    ).toEqual({ key: "amount", dir: "desc" });
  });

  it("defaults dir to asc", () => {
    expect(parsePaymentSort(new URLSearchParams("sort=date"))).toEqual({
      key: "date",
      dir: "asc",
    });
  });

  it("ignores unknown sort keys and dirs", () => {
    expect(parsePaymentSort(new URLSearchParams("sort=payer&dir=sideways"))).toEqual({
      key: null,
      dir: "asc",
    });
    expect(parsePaymentSort(new URLSearchParams("dir=desc"))).toEqual({
      key: null,
      dir: "asc",
    });
  });
});

describe("getSortParamUpdates", () => {
  it("serializes an active sort", () => {
    expect(getSortParamUpdates({ key: "status", dir: "desc" })).toEqual({
      sort: "status",
      dir: "desc",
    });
  });

  it("maps a cleared sort to null params (removed from the URL)", () => {
    expect(getSortParamUpdates({ key: null, dir: "asc" })).toEqual({
      sort: null,
      dir: null,
    });
  });
});

describe("getNextSort", () => {
  it("cycles none → asc → desc → none on the same column", () => {
    const none: ReturnType<typeof getNextSort> = { key: null, dir: "asc" };
    const asc = getNextSort(none, "amount");
    expect(asc).toEqual({ key: "amount", dir: "asc" });
    expect(getNextSort(asc, "amount")).toEqual({ key: "amount", dir: "desc" });
    expect(getNextSort({ key: "amount", dir: "desc" } as const, "amount")).toEqual({
      key: null,
      dir: "asc",
    });
  });

  it("starts at ascending when switching columns", () => {
    const onAmount = { key: "amount", dir: "desc" } as const;
    expect(getNextSort(onAmount, "date")).toEqual({ key: "date", dir: "asc" });
  });
});

describe("applyPaymentSort", () => {
  it("returns the original array when no sort is active", () => {
    const sorted = applyPaymentSort(PAYMENTS, { key: null, dir: "asc" });
    expect(sorted).toEqual(PAYMENTS);
    expect(sorted).toBe(PAYMENTS); // no copy, no work
  });

  it("sorts by amount ascending and descending", () => {
    const asc = applyPaymentSort(PAYMENTS, { key: "amount", dir: "asc" });
    expect(asc.map((p) => p.id)).toEqual([2, 3, 1]);

    const desc = applyPaymentSort(PAYMENTS, { key: "amount", dir: "desc" });
    expect(desc.map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("sorts by date (timestamp)", () => {
    const asc = applyPaymentSort(PAYMENTS, { key: "date", dir: "asc" });
    expect(asc.map((p) => p.id)).toEqual([2, 3, 1]);

    const desc = applyPaymentSort(PAYMENTS, { key: "date", dir: "desc" });
    expect(desc.map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("sorts by status", () => {
    const asc = applyPaymentSort(PAYMENTS, { key: "status", dir: "asc" });
    // CANCELLED < RECORDED alphabetically
    expect(asc.map((p) => p.id)).toEqual([2, 1, 3]);

    const desc = applyPaymentSort(PAYMENTS, { key: "status", dir: "desc" });
    expect(desc.map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("sorts missing timestamps as the oldest (first asc, last desc)", () => {
    const missing = [
      payment({ id: 1, timestamp: 2000 }),
      payment({ id: 2, timestamp: undefined }),
    ];
    expect(applyPaymentSort(missing, { key: "date", dir: "asc" }).map((p) => p.id)).toEqual([
      2, 1,
    ]);
    expect(applyPaymentSort(missing, { key: "date", dir: "desc" }).map((p) => p.id)).toEqual([
      1, 2,
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...PAYMENTS];
    applyPaymentSort(input, { key: "amount", dir: "desc" });
    expect(input).toEqual(PAYMENTS);
  });
});
