// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "@/components/OfflineBanner";

describe("OfflineBanner", () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalOnLine,
    });
  });

  it("renders null when online initially", () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    expect(screen.queryByText(/Offline - displaying cached data/i)).toBeNull();
  });

  it("renders banner immediately when offline initially", () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(<OfflineBanner />);
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.getByText("Offline - displaying cached data")).toBeInTheDocument();
  });

  it("shows banner on window offline event and hides on online event", () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();

    // Trigger offline event
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    expect(screen.getByText("Offline - displaying cached data")).toBeInTheDocument();

    // Trigger online event
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("removes event listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<OfflineBanner />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    removeSpy.mockRestore();
  });
});
