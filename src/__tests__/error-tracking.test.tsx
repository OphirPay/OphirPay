// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useErrorTracker } from "@/hooks/useErrorTracker";
import {
  captureError,
  captureMessage,
  scrubString,
  scrubPii,
  recordErrorReport,
  getStoredErrorReports,
  clearStoredErrorReports,
  type ErrorReport,
} from "@/lib/sentry";

// Component that throws a deliberate render error
function CrashComponent({ message }: { message: string }) {
  throw new Error(message);
}

describe("End-to-End Error Tracking & Reporting", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredErrorReports();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    clearStoredErrorReports();
  });

  describe("ErrorBoundary report generation & deduplication", () => {
    it("produces a queryable report with release tag on render crash", () => {
      let capturedReport: ErrorReport | undefined;

      render(
        <ErrorBoundary
          componentName="TestCrashBoundary"
          onError={(_err, _info, report) => {
            capturedReport = report;
          }}
        >
          <CrashComponent message="Deliberate crash in checkout flow" />
        </ErrorBoundary>
      );

      // Verify fallback UI rendered
      expect(screen.getByText("Something went wrong")).toBeDefined();

      // Verify report was captured with required shape
      expect(capturedReport).toBeDefined();
      expect(capturedReport?.name).toBe("Error");
      expect(capturedReport?.message).toBe("Deliberate crash in checkout flow");
      expect(capturedReport?.component).toBe("TestCrashBoundary");
      expect(capturedReport?.release).toBeDefined();
      expect(typeof capturedReport?.release).toBe("string");
      expect(capturedReport?.count).toBe(1);
      expect(capturedReport?.fingerprint).toBeDefined();
      expect(capturedReport?.firstSeen).toBeDefined();
      expect(capturedReport?.lastSeen).toBeDefined();

      // Verify report is queryable in store
      const stored = getStoredErrorReports({ component: "TestCrashBoundary" });
      expect(stored.length).toBe(1);
      expect(stored[0].id).toBe(capturedReport?.id);
      expect(stored[0].release).toBe(capturedReport?.release);
    });

    it("deduplicates identical render crashes and increments count", () => {
      // First crash
      render(
        <ErrorBoundary componentName="PaymentModal">
          <CrashComponent message="Network timeout connecting to Horizon" />
        </ErrorBoundary>
      );

      // Second identical crash
      render(
        <ErrorBoundary componentName="PaymentModal">
          <CrashComponent message="Network timeout connecting to Horizon" />
        </ErrorBoundary>
      );

      const reports = getStoredErrorReports({ component: "PaymentModal" });
      // Deduplicated to single report entry
      expect(reports.length).toBe(1);
      expect(reports[0].count).toBe(2);
      expect(reports[0].component).toBe("PaymentModal");
    });
  });

  describe("PII Scrubbing", () => {
    const PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    const SECRET_KEY = "SBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    it("scrubs wallet addresses, amounts, and memos by default", () => {
      const sensitiveMsg = `Payment of 250.75 XLM to ${PUBLIC_KEY} failed with memo Invoice-12345`;
      const report = captureError(new Error(sensitiveMsg), {
        component: "SendForm",
        extra: {
          memo: "Private secret transaction",
          amount: 250.75,
          wallet: PUBLIC_KEY,
        },
      });

      // Public key must be scrubbed
      expect(report.message).not.toContain(PUBLIC_KEY);
      expect(report.message).toContain("[REDACTED_ADDRESS]");

      // Amount in message must be scrubbed
      expect(report.message).not.toContain("250.75 XLM");
      expect(report.message).toContain("[REDACTED_AMOUNT]");

      // Extra fields must be scrubbed
      expect(report.extra?.memo).toBe("[REDACTED_MEMO]");
      expect(report.extra?.amount).toBe("[REDACTED_AMOUNT]");
      expect(report.extra?.wallet).toBe("[REDACTED_ADDRESS]");
    });

    it("scrubs secret keys unconditionally even when optInPii is true", () => {
      const secretMsg = `Signing key ${SECRET_KEY} leaked in error stack`;
      const report = captureError(new Error(secretMsg), {
        optInPii: true,
        extra: {
          secret: SECRET_KEY,
          apiKey: "sk_live_secret_key_12345",
        },
      });

      expect(report.message).not.toContain(SECRET_KEY);
      expect(report.message).toContain("[REDACTED_SECRET]");
      expect(report.extra?.secret).toBe("[REDACTED]");
      expect(report.extra?.apiKey).toBe("[REDACTED]");
    });

    it("allows public wallet addresses and amounts when explicitly opted in", () => {
      const msg = `Transaction for ${PUBLIC_KEY} failed for amount 500 USDC`;
      const report = captureError(new Error(msg), {
        optInPii: true,
        extra: {
          wallet: PUBLIC_KEY,
          amount: 500,
        },
      });

      // Public address and amount are preserved when opted in
      expect(report.message).toContain(PUBLIC_KEY);
      expect(report.message).toContain("500 USDC");
      expect(report.extra?.wallet).toBe(PUBLIC_KEY);
      expect(report.extra?.amount).toBe(500);
    });

    it("scrubs emails and bearer tokens always", () => {
      const text = "Error reported by user test@example.com using Bearer eyJhbGciOi...";
      const scrubbed = scrubString(text);
      expect(scrubbed).toContain("[REDACTED_EMAIL]");
      expect(scrubbed).toContain("Bearer [REDACTED]");
      expect(scrubbed).not.toContain("test@example.com");
    });
  });

  describe("useErrorTracker hook report shape and contract", () => {
    function HookTestComponent({ onTrack }: { onTrack: (report: ErrorReport) => void }) {
      const { trackError } = useErrorTracker("AccountSettings", { segment: "/settings" });

      React.useEffect(() => {
        const report = trackError(
          new Error("Invalid fee configuration"),
          { settingKey: "maxFee" },
          { tier: "pro" }
        );
        onTrack(report);
      }, [trackError, onTrack]);

      return <div>Hook Test</div>;
    }

    it("captures errors through the hook with correct shape, component, and segment", () => {
      let report: ErrorReport | undefined;

      render(<HookTestComponent onTrack={(r) => { report = r; }} />);

      expect(report).toBeDefined();
      expect(report?.name).toBe("Error");
      expect(report?.message).toBe("Invalid fee configuration");
      expect(report?.component).toBe("AccountSettings");
      expect(report?.segment).toBe("/settings");
      expect(report?.release).toBeDefined();
      expect(report?.extra?.settingKey).toBe("maxFee");
      expect(report?.tags?.tier).toBe("pro");
    });
  });

  describe("Graceful degradation when Sentry DSN is unset", () => {
    it("degrades to logging without throwing any error", () => {
      const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      expect(() => {
        captureError(new Error("Unset DSN test error"), { component: "DegradationCheck" });
      }).not.toThrow();

      expect(() => {
        captureMessage("Informational notice", "info");
      }).not.toThrow();

      const stored = getStoredErrorReports({ component: "DegradationCheck" });
      expect(stored.length).toBe(1);
      expect(stored[0].message).toBe("Unset DSN test error");

      if (originalDsn) {
        process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
      }
    });
  });

  describe("Query API and filtering", () => {
    it("filters reports by release, component, and segment", () => {
      recordErrorReport({
        name: "TypeError",
        message: "Undefined property",
        component: "BatchList",
        segment: "/batches",
        release: "0.1.0",
      });

      recordErrorReport({
        name: "RangeError",
        message: "Out of bounds",
        component: "StreamList",
        segment: "/streams",
        release: "0.2.0",
      });

      // Filter by component
      const batchReports = getStoredErrorReports({ component: "BatchList" });
      expect(batchReports.length).toBe(1);
      expect(batchReports[0].component).toBe("BatchList");

      // Filter by release
      const v2Reports = getStoredErrorReports({ release: "0.2.0" });
      expect(v2Reports.length).toBe(1);
      expect(v2Reports[0].component).toBe("StreamList");

      // Filter by segment
      const streamSegmentReports = getStoredErrorReports({ segment: "/streams" });
      expect(streamSegmentReports.length).toBe(1);
      expect(streamSegmentReports[0].segment).toBe("/streams");
    });
  });
});
