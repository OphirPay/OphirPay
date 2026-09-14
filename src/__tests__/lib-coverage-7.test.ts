// SPDX-License-Identifier: MIT
//
// Edge-path coverage for small pure-lib modules: each test below exercises a
// real (reachable) branch that the main suites miss, e.g. string-vs-number
// inputs, not-found / failure paths, and env-dependent behavior. Kept as one
// wave-numbered file per repo convention (see lib-coverage-2..6).

import { describe, it, expect, vi, afterEach } from "vitest";
import { sendEmail } from "@/lib/email";
import {
  captureHealthSnapshot,
  formatHealthSnapshot,
  logMemoryUsage,
} from "@/lib/monitoring";
import { getAppUrl, isProduction, getDatabaseProvider } from "@/lib/env";
import { exportToCsv } from "@/lib/csv";
import {
  formatXlm,
  formatFiat,
  formatTokenAmount,
  formatCompact,
} from "@/lib/format-currency";
import {
  formatStroopsToXlm,
  formatBaseFee,
  estimateTotalCost,
} from "@/lib/gas-estimate";
import {
  buildTxSummary,
  buildBatchSummary,
  shortenAddress,
} from "@/lib/string-builder";
import { nextRunAt, frequencyLabel } from "@/lib/recurrence";
import { Prisma } from "@prisma/client";
import { handlePrismaError } from "@/lib/prisma-errors";
import { isOnChainId, assertNonNull, isError } from "@/lib/type-guards";
import { logger } from "@/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ─── email ─────────────────────────────────────────────────────

describe("email", () => {
  it("sendEmail returns false outside development (no provider wired)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>" })
    ).resolves.toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("sendEmail dev-mode branch logs and returns true", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      sendEmail({ to: "a@b.c", subject: "s", html: "<p>x</p>" })
    ).resolves.toBe(true);
    expect(logSpy).toHaveBeenCalledWith("[Email Dev]", expect.any(Object));
  });
});

// ─── monitoring ────────────────────────────────────────────────

describe("monitoring", () => {
  it("captureHealthSnapshot returns numeric fields", () => {
    const s = captureHealthSnapshot();
    expect(typeof s.timestamp).toBe("number");
    expect(typeof s.uptime).toBe("number");
    expect(s.memoryUsage.heapUsed).toBeGreaterThanOrEqual(0);
    expect(typeof s.activeConnections).toBe("number");
  });

  it("formatHealthSnapshot summarizes uptime and heap", () => {
    const text = formatHealthSnapshot({
      timestamp: 1,
      uptime: 3725, // 1h 2m
      memoryUsage: { heapUsed: 10 * 1024 * 1024, heapTotal: 20 * 1024 * 1024, rss: 0 },
      activeConnections: 0,
    });
    expect(text).toContain("Uptime: 1h 2m");
    expect(text).toContain("10.0MB used");
  });

  it("logMemoryUsage warns on high heap ratio", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 90 * 1024 * 1024,
      heapTotal: 100 * 1024 * 1024,
      rss: 0,
      arrayBuffers: 0,
      external: 0,
    });
    logMemoryUsage();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("logMemoryUsage stays quiet on a healthy heap ratio", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      heapUsed: 10 * 1024 * 1024,
      heapTotal: 100 * 1024 * 1024,
      rss: 0,
      arrayBuffers: 0,
      external: 0,
    });
    logMemoryUsage();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── env ───────────────────────────────────────────────────────

describe("env", () => {
  it("getAppUrl strips a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ophirpay.example/");
    expect(getAppUrl()).toBe("https://ophirpay.example");
  });

  it("getAppUrl falls back to localhost when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("isProduction / getDatabaseProvider read the environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("DATABASE_PROVIDER", "sqlite");
    expect(getDatabaseProvider()).toBe("sqlite");
  });
});

// ─── csv ───────────────────────────────────────────────────────

describe("csv exportToCsv", () => {
  it("quotes fields containing delimiter, quote, or newline", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    expect(() =>
      exportToCsv(
        [{ note: 'say "hi", ok' }, { note: "line1\nline2" }],
        [{ key: "note", header: "Note" }],
        { filename: "notes.csv" }
      )
    ).not.toThrow();
    expect(clickSpy).toHaveBeenCalled();
  });

  it("treats a missing row key as an empty field", () => {
    const rows: Array<Record<string, string>> = [{ name: "x" }];
    expect(() =>
      exportToCsv(
        rows,
        [
          { key: "name", header: "Name" },
          { key: "missing", header: "Missing" },
        ]
      )
    ).not.toThrow();
  });
});

// ─── format-currency ───────────────────────────────────────────

describe("format-currency string inputs", () => {
  it("formatXlm accepts a numeric string", () => {
    expect(formatXlm("10000000")).toBe(formatXlm(10000000));
  });

  it("formatFiat accepts a numeric string", () => {
    expect(formatFiat("12.5", "USD")).toBe(formatFiat(12.5, "USD"));
  });

  it("formatTokenAmount accepts a numeric string", () => {
    expect(formatTokenAmount("2.5", "XLM")).toBe(formatTokenAmount(2.5, "XLM"));
  });

  it("formatCompact accepts a numeric string", () => {
    expect(formatCompact("1500")).toBe(formatCompact(1500));
  });
});

// ─── gas-estimate ──────────────────────────────────────────────

describe("gas-estimate", () => {
  it("formatStroopsToXlm accepts a numeric string", () => {
    expect(formatStroopsToXlm("100")).toBe("0.00001 XLM");
  });

  it("formatBaseFee flags the minimum and formats others", () => {
    expect(formatBaseFee(100)).toBe("0.00001 XLM (minimum)");
    expect(formatBaseFee(200)).toBe("0.00002 XLM");
  });

  it("estimateTotalCost computes stroops and xlm", () => {
    expect(estimateTotalCost(2)).toEqual({ stroops: 200, xlm: "0.00002 XLM" });
    expect(estimateTotalCost(3, 150)).toEqual({ stroops: 450, xlm: "0.000045 XLM" });
  });
});

// ─── string-builder ────────────────────────────────────────────

describe("string-builder", () => {
  it("buildTxSummary renders payer → payee · amount asset", () => {
    expect(
      buildTxSummary({
        payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amount: "100",
        asset: "XLM",
      })
    ).toContain("· 100 XLM");
  });

  it("buildBatchSummary singular vs plural", () => {
    expect(buildBatchSummary({ totalPayments: 1, totalAmount: "10", asset: "XLM" })).toBe(
      "1 payment · 10 XLM total"
    );
    expect(buildBatchSummary({ totalPayments: 3, totalAmount: "30", asset: "XLM" })).toBe(
      "3 payments · 30 XLM total"
    );
  });

  it("shortenAddress leaves short addresses untouched", () => {
    expect(shortenAddress("GABC", 4)).toBe("GABC");
    expect(shortenAddress("G" + "A".repeat(55))).toContain("...");
  });
});

// ─── recurrence ────────────────────────────────────────────────

describe("recurrence", () => {
  it("nextRunAt throws for an unsupported frequency", () => {
    expect(() => nextRunAt(new Date(), "HOURLY" as never)).toThrow(
      "Unsupported frequency: HOURLY"
    );
  });

  it("frequencyLabel falls back to the raw value for unknown frequencies", () => {
    expect(frequencyLabel("FORTNIGHTLY")).toBe("FORTNIGHTLY");
    expect(frequencyLabel("YEARLY")).toBe("Yearly");
  });
});

// ─── prisma-errors ─────────────────────────────────────────────

describe("handlePrismaError remaining branches", () => {
  it("maps P2003 foreign key to 400", () => {
    const err = new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "6.19.3",
    });
    expect(handlePrismaError(err).code).toBe("FOREIGN_KEY");
    expect(handlePrismaError(err).status).toBe(400);
  });

  it("maps P2014 relation violation to 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("rel", {
      code: "P2014",
      clientVersion: "6.19.3",
    });
    expect(handlePrismaError(err).code).toBe("RELATION_VIOLATION");
    expect(handlePrismaError(err).status).toBe(409);
  });

  it("falls back to 'field' when P2002 meta lacks a target", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6.19.3",
    });
    expect(handlePrismaError(err).message).toContain("field already exists");
  });

  it("maps validation and initialization errors", () => {
    const validation = new Prisma.PrismaClientValidationError("bad input", {
      clientVersion: "6.19.3",
    });
    expect(handlePrismaError(validation).code).toBe("VALIDATION_ERROR");

    const init = new Prisma.PrismaClientInitializationError(
      "no conn",
      "6.19.3"
    );
    expect(handlePrismaError(init).code).toBe("DB_CONNECTION");
  });
});

// ─── type-guards ───────────────────────────────────────────────

describe("type-guards edges", () => {
  it("isOnChainId rejects floats beyond safe integer precision", () => {
    expect(isOnChainId("9007199254740992")).toBe(false);
    expect(isOnChainId(1.5)).toBe(false);
  });

  it("assertNonNull passes values through and throws with a custom message", () => {
    expect(() => assertNonNull("ok")).not.toThrow();
    expect(() => assertNonNull(null, "custom boom")).toThrow("custom boom");
    expect(() => assertNonNull(undefined)).toThrow("Value is null/undefined");
  });

  it("isError distinguishes Error from plain values", () => {
    expect(isError(new Error("x"))).toBe(true);
    expect(isError({ message: "x" })).toBe(false);
  });
});
