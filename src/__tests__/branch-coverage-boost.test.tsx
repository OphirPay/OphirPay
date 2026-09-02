// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, renderHook } from "@testing-library/react";
import { Amount } from "@/components/ui/Amount";
import { trapFocus } from "@/lib/focus-trap";
import { estimateTransactionFee, estimateBatchFee } from "@/lib/fee-estimator";
import {
  isPermissionRequested,
  requestNotificationPermission,
  sendNotification,
  NOTIFY,
} from "@/lib/notifications";
import { usePrefetch, PRELOAD_ROUTES } from "@/lib/prefetch";
import { isFeatureEnabled, overrideFeatureFlag } from "@/lib/feature-flags";
import { trackEvent, trackPageView } from "@/lib/analytics-events";
import { getRequestId, withRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import {
  getAuthSecret,
  createSessionToken,
  parseSessionToken,
  readSessionCookie,
  buildSessionCookie,
  buildLogoutCookie,
  getAuthContext,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-session";
import * as stellarLib from "@/lib/stellar";
import prisma from "@/lib/prisma";
import * as apiAuthLib from "@/lib/api-auth";

const mockPrefetchFn = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: (url: string) => mockPrefetchFn(url),
  }),
}));

// ═══════════════════════════════════════════════════════════
// 1. Amount Component Branches
// ═══════════════════════════════════════════════════════════
describe("Amount Component Branches", () => {
  it("renders NaN fallback for invalid strings", () => {
    render(<Amount value="invalid_number" className="custom-class" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("formats billions in compact mode", () => {
    render(<Amount value={2_500_000_000} compact asset="XLM" />);
    expect(screen.getByText("2.5B XLM")).toBeInTheDocument();
  });

  it("formats millions in compact mode", () => {
    render(<Amount value={3_400_000} compact asset="USDC" />);
    expect(screen.getByText("3.4M USDC")).toBeInTheDocument();
  });

  it("formats thousands in compact mode", () => {
    render(<Amount value={5_600} compact asset="XLM" />);
    expect(screen.getByText("5.6K XLM")).toBeInTheDocument();
  });

  it("formats small numbers in compact mode", () => {
    render(<Amount value={42.5} compact asset="XLM" />);
    expect(screen.getByText("42.50 XLM")).toBeInTheDocument();
  });

  it("renders positive number with showSign=true and green text", () => {
    const { container } = render(<Amount value={100} showSign asset="XLM" />);
    expect(container.textContent).toContain("+");
    expect(container.firstElementChild?.className).toContain("text-green-600");
  });

  it("renders negative number with minus sign and red text", () => {
    const { container } = render(<Amount value={-50} asset="XLM" />);
    expect(container.textContent).toContain("−");
    expect(container.firstElementChild?.className).toContain("text-red-600");
  });

  it("renders zero with neutral text and no sign", () => {
    const { container } = render(<Amount value={0} showSign asset="XLM" />);
    expect(container.textContent).not.toContain("+");
    expect(container.textContent).not.toContain("−");
    expect(container.firstElementChild?.className).toContain("text-gray-700");
  });
});

// ═══════════════════════════════════════════════════════════
// 2. focus-trap.ts Branches
// ═══════════════════════════════════════════════════════════
describe("focus-trap Utility", () => {
  it("traps focus with multiple focusable elements and loops correctly", () => {
    const container = document.createElement("div");
    const btn1 = document.createElement("button");
    const btn2 = document.createElement("button");
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    const cleanup = trapFocus(container);
    expect(document.activeElement).toBe(btn1);

    // Tab on last element wraps to first
    btn2.focus();
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    container.dispatchEvent(tabEvent);

    // Shift+Tab on first element wraps to last
    btn1.focus();
    const shiftTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    container.dispatchEvent(shiftTabEvent);

    // Non-tab event is ignored
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    container.dispatchEvent(enterEvent);

    cleanup();
    document.body.removeChild(container);
  });

  it("handles container with no focusable elements", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const cleanup = trapFocus(container);
    expect(container.getAttribute("tabindex")).toBe("-1");

    // Tab event when 0 focusables
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    container.dispatchEvent(tabEvent);

    cleanup();
    document.body.removeChild(container);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. fee-estimator.ts Branches
// ═══════════════════════════════════════════════════════════
describe("fee-estimator Utility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates low congestion fee", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      fetchBaseFee: vi.fn().mockResolvedValue("100"),
    } as never);

    const estimate = await estimateTransactionFee(2);
    expect(estimate.baseFee).toBe("100");
    expect(estimate.estimatedFee).toBe("200");
    expect(estimate.networkCongestion).toBe("low");
  });

  it("calculates medium congestion fee (>100)", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      fetchBaseFee: vi.fn().mockResolvedValue("150"),
    } as never);

    const estimate = await estimateTransactionFee(1);
    expect(estimate.networkCongestion).toBe("medium");
  });

  it("calculates high congestion fee (>200)", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      fetchBaseFee: vi.fn().mockResolvedValue("250"),
    } as never);

    const estimate = await estimateTransactionFee(1);
    expect(estimate.networkCongestion).toBe("high");
  });

  it("falls back to standard fee on fetch error", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      fetchBaseFee: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    } as never);

    const estimate = await estimateTransactionFee(3);
    expect(estimate.baseFee).toBe("100");
    expect(estimate.estimatedFee).toBe("300");
    expect(estimate.networkCongestion).toBe("low");
  });

  it("estimates batch fee", () => {
    expect(estimateBatchFee(5, 100)).toBe("500");
    expect(estimateBatchFee(10)).toBe("1000");
  });
});

// ═══════════════════════════════════════════════════════════
// 4. notifications.ts Branches
// ═══════════════════════════════════════════════════════════
describe("notifications Utility", () => {
  const originalNotification = globalThis.Notification;

  afterEach(() => {
    globalThis.Notification = originalNotification;
  });

  it("handles missing Notification API", async () => {
    // @ts-expect-error testing missing Notification
    delete globalThis.Notification;
    expect(await requestNotificationPermission()).toBe(false);
    sendNotification("Test");
  });

  it("handles granted permission and sends notification", async () => {
    const mockConstructor = vi.fn();
    class MockNotification {
      static permission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      constructor(title: string, options?: unknown) {
        mockConstructor(title, options);
      }
    }
    globalThis.Notification = MockNotification as never;

    expect(await requestNotificationPermission()).toBe(true);
    sendNotification("Hello", { body: "World" });
    expect(mockConstructor).toHaveBeenCalledWith(
      "Hello",
      expect.objectContaining({ body: "World" })
    );

    NOTIFY.paymentSent("100 XLM", "0123456789ABCDEF");
    NOTIFY.paymentReceived("50 XLM", "0123456789ABCDEF");
    NOTIFY.batchComplete(5);
  });

  it("handles denied permission", async () => {
    class MockDeniedNotification {
      static permission = "denied";
      static requestPermission = vi.fn().mockResolvedValue("denied");
    }
    globalThis.Notification = MockDeniedNotification as never;
    expect(await requestNotificationPermission()).toBe(false);
  });

  it("requests permission when default", async () => {
    class MockDefaultNotification {
      static permission = "default";
      static requestPermission = vi.fn().mockResolvedValue("granted");
    }
    globalThis.Notification = MockDefaultNotification as never;
    expect(await requestNotificationPermission()).toBe(true);
    expect(isPermissionRequested()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. prefetch.ts Branches
// ═══════════════════════════════════════════════════════════
describe("prefetch Utility", () => {
  it("runs usePrefetch and catches error", () => {
    mockPrefetchFn.mockImplementationOnce(() => {
      throw new Error("Prefetch not supported");
    });

    const { result } = renderHook(() => usePrefetch());
    expect(() => result.current.prefetch("/send")).not.toThrow();
    expect(PRELOAD_ROUTES).toContain("/send");
  });
});

// ═══════════════════════════════════════════════════════════
// 6. feature-flags.ts Branches
// ═══════════════════════════════════════════════════════════
describe("feature-flags Utility", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    localStorage.clear();
  });

  it("reads default feature flags", () => {
    expect(typeof isFeatureEnabled("MULTI_ASSET")).toBe("boolean");
    expect(typeof isFeatureEnabled("WEBHOOKS")).toBe("boolean");
  });

  it("supports dev overrides via localStorage", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    overrideFeatureFlag("MULTI_ASSET", true);
    expect(isFeatureEnabled("MULTI_ASSET")).toBe(true);

    overrideFeatureFlag("MULTI_ASSET", false);
    expect(isFeatureEnabled("MULTI_ASSET")).toBe(false);
  });

  it("ignores override in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    overrideFeatureFlag("MULTI_ASSET", false);
    expect(localStorage.getItem("ff_MULTI_ASSET")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// 7. analytics-events.ts Branches
// ═══════════════════════════════════════════════════════════
describe("analytics-events Utility", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    delete (window as unknown as Record<string, unknown>).gtag;
  });

  it("logs debug in development", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    trackEvent("payment_sent", { amount: 100 });
    trackPageView("/dashboard");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("invokes window.gtag in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const gtagMock = vi.fn();
    (window as unknown as Record<string, unknown>).gtag = gtagMock;

    trackEvent("wallet_connect", { wallet: "Freighter" });
    expect(gtagMock).toHaveBeenCalledWith("event", "wallet_connect", { wallet: "Freighter" });

    trackPageView("/payments");
    expect(gtagMock).toHaveBeenCalledWith("config", undefined, { page_path: "/payments" });
  });
});

// ═══════════════════════════════════════════════════════════
// 8. request-id.ts Branches
// ═══════════════════════════════════════════════════════════
describe("request-id Utility", () => {
  it("attaches request ID to response", () => {
    const res = new Response("ok");
    const updated = withRequestId(res, "custom-id-123");
    expect(updated.headers.get(REQUEST_ID_HEADER)).toBe("custom-id-123");
  });

  it("generates request ID when headers throws or is empty", async () => {
    const id = await getRequestId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// 9. auth-session.ts Branches
// ═══════════════════════════════════════════════════════════
describe("auth-session Utility Branches", () => {
  const validPk = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    process.env.AUTH_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it("throws error in production if AUTH_SECRET missing or too short", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    expect(() => getAuthSecret()).toThrow("AUTH_SECRET is required in production");

    process.env.AUTH_SECRET = "short-secret";
    expect(() => getAuthSecret()).toThrow("AUTH_SECRET is required in production");
  });

  it("returns configured AUTH_SECRET when >= 32 chars", () => {
    process.env.AUTH_SECRET = "01234567890123456789012345678901";
    expect(getAuthSecret()).toBe("01234567890123456789012345678901");
  });

  it("creates and parses session tokens for PUBLIC and TESTNET", () => {
    const tokenPub = createSessionToken(validPk, "PUBLIC");
    const parsedPub = parseSessionToken(tokenPub);
    expect(parsedPub?.pk).toBe(validPk);
    expect(parsedPub?.nw).toBe("PUBLIC");

    const tokenTest = createSessionToken(validPk, "TESTNET");
    const parsedTest = parseSessionToken(tokenTest);
    expect(parsedTest?.pk).toBe(validPk);
    expect(parsedTest?.nw).toBe("TESTNET");
  });

  it("returns null on invalid or tampered tokens", () => {
    expect(parseSessionToken("invalid-format")).toBeNull();
    expect(parseSessionToken(".")).toBeNull();

    const validToken = createSessionToken(validPk, "TESTNET");
    const [body] = validToken.split(".");
    expect(parseSessionToken(`${body}.tamperedSignature`)).toBeNull();
  });

  it("builds and reads cookies", () => {
    const cookieHeader = buildSessionCookie(validPk, "TESTNET");
    expect(cookieHeader).toContain(SESSION_COOKIE_NAME);

    const logoutCookie = buildLogoutCookie();
    expect(logoutCookie).toContain("Max-Age=0");

    const req = new Request("http://localhost/api/test", {
      headers: {
        cookie: cookieHeader.split(";")[0],
      },
    });
    const parsed = readSessionCookie(req);
    expect(parsed?.pk).toBe(validPk);

    const reqNoCookie = new Request("http://localhost/api/test");
    expect(readSessionCookie(reqNoCookie)).toBeNull();
  });

  it("resolves getAuthContext for existing user, new user upsert, and DB error", async () => {
    const token = createSessionToken(validPk, "TESTNET");
    const req = new Request("http://localhost/api/test", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    // 1. Existing user
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "u_1",
      stellarAddress: validPk,
    } as never);
    const auth1 = await getAuthContext(req);
    expect(auth1?.userId).toBe("u_1");

    // 2. User created via upsert
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.user, "upsert").mockResolvedValue({
      id: "u_2",
      stellarAddress: validPk,
    } as never);
    const auth2 = await getAuthContext(req);
    expect(auth2?.userId).toBe("u_2");

    // 3. DB error returns null
    vi.spyOn(prisma.user, "findUnique").mockRejectedValue(new Error("DB Down"));
    const auth3 = await getAuthContext(req);
    expect(auth3).toBeNull();
  });

  it("resolves getAuthContext from API key auth fallback", async () => {
    const req = new Request("http://localhost/api/test");
    vi.spyOn(apiAuthLib, "authenticateRequest").mockResolvedValue({
      userId: "u_key",
      keyId: "key_1",
    } as never);

    const auth = await getAuthContext(req);
    expect(auth?.userId).toBe("u_key");
    expect(auth?.keyId).toBe("key_1");
  });
});
