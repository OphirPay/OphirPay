// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { OfflineBanner } from "@/components/OfflineBanner";

describe("OfflineBanner component", () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe("reconnection event triggers", () => {
    it("appears when offline event fires on window", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      expect(screen.queryByTestId("offline-banner")).toBeNull();

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      expect(screen.getByTestId("offline-banner")).toBeDefined();
      expect(screen.getByTestId("offline-banner").textContent).toContain(
        "Offline - displaying cached data"
      );
    });

    it("disappears when online event fires on window", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      expect(screen.getByTestId("offline-banner")).toBeDefined();

      act(() => {
        window.dispatchEvent(new Event("online"));
      });

      expect(screen.queryByTestId("offline-banner")).toBeNull();
    });

    it("has aria-live polite for accessibility when offline", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      const banner = screen.getByTestId("offline-banner");

      expect(banner.getAttribute("aria-live")).toBe("polite");
    });

    it("has role status for screen reader announcements", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      const banner = screen.getByTestId("offline-banner");

      expect(banner.getAttribute("role")).toBe("status");
    });

    it("handles rapid offline and online transitions", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByTestId("offline-banner")).toBeDefined();

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(screen.queryByTestId("offline-banner")).toBeNull();

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });
      expect(screen.getByTestId("offline-banner")).toBeDefined();

      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(screen.queryByTestId("offline-banner")).toBeNull();
    });

    it("cleans up event listeners on component unmount", () => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
        writable: true,
      });

      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = render(<OfflineBanner />);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "offline",
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "online",
        expect.any(Function)
      );

      removeEventListenerSpy.mockRestore();
    });

    it("applies sticky positioning and z-50 styling for visibility", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      const banner = screen.getByTestId("offline-banner");

      expect(banner.className).toContain("sticky");
      expect(banner.className).toContain("top-0");
      expect(banner.className).toContain("z-50");
      expect(banner.className).toContain("w-full");
    });

    it("displays correct styling when offline - amber background and white text", () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });

      render(<OfflineBanner />);
      const banner = screen.getByTestId("offline-banner");

      expect(banner.className).toContain("bg-amber-500");
      expect(banner.className).toContain("text-white");
    });
  });
});
