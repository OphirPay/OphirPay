// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "@/components/OfflineBanner";

describe("OfflineBanner component", () => {
  const originalOnLine = navigator.onLine;

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: originalOnLine,
      configurable: true,
      writable: true,
    });
  });

  it("is hidden when browser is initially online", () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });

    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("renders with 'Offline - displaying cached data' when initially offline", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
      writable: true,
    });

    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain("Offline - displaying cached data");
    expect(banner.getAttribute("role")).toBe("status");
  });

  it("transitions between offline and online states upon window events", () => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });

    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();

    // Trigger offline event
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain("Offline - displaying cached data");

    // Trigger online event
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});
