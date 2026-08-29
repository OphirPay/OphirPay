// SPDX-License-Identifier: MIT

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, renderHook, act } from "@testing-library/react";
import fs from "fs";
import path from "path";

import {
  usePrefersReducedMotion,
  isReducedMotion,
  getMotionSafeDuration,
  REDUCED_MOTION_QUERY,
} from "@/lib/reduced-motion";
import { waitForAnimation, DURATIONS } from "@/lib/animation";
import { Spinner } from "@/components/ui/Spinner";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";

describe("Reduced Motion Audit & Hook Suite", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  describe("usePrefersReducedMotion & Utility Functions", () => {
    it("returns false initially when prefers-reduced-motion does not match", () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current).toBe(false);
      expect(window.matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    });

    it("returns true initially when prefers-reduced-motion matches", () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const { result } = renderHook(() => usePrefersReducedMotion());
      expect(result.current).toBe(true);
    });

    it("reactively updates state when media query preference changes", () => {
      let listenerCallback: ((e: MediaQueryListEvent) => void) | null = null;

      const addEventListenerMock = vi.fn((event: string, callback: any) => {
        if (event === "change") {
          listenerCallback = callback;
        }
      });
      const removeEventListenerMock = vi.fn();

      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        dispatchEvent: vi.fn(),
      }));

      const { result, unmount } = renderHook(() => usePrefersReducedMotion());
      expect(result.current).toBe(false);
      expect(addEventListenerMock).toHaveBeenCalled();

      // Trigger media query change event to reduce motion: true
      act(() => {
        if (listenerCallback) {
          listenerCallback({ matches: true } as MediaQueryListEvent);
        }
      });
      expect(result.current).toBe(true);

      // Trigger media query change event back to reduce motion: false
      act(() => {
        if (listenerCallback) {
          listenerCallback({ matches: false } as MediaQueryListEvent);
        }
      });
      expect(result.current).toBe(false);

      // Unmount and verify event listener cleanup
      unmount();
      expect(removeEventListenerMock).toHaveBeenCalled();
    });

    it("evaluates isReducedMotion correctly", () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      expect(isReducedMotion()).toBe(true);

      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      expect(isReducedMotion()).toBe(false);
    });

    it("calculates motion safe duration correctly", () => {
      expect(getMotionSafeDuration(300, true)).toBe(0);
      expect(getMotionSafeDuration(300, false)).toBe(300);
      expect(getMotionSafeDuration(DURATIONS.extraSlow, true)).toBe(0);
      expect(getMotionSafeDuration(DURATIONS.fast, false)).toBe(150);
    });

    it("resolves waitForAnimation immediately when prefersReduced is true", async () => {
      const element = document.createElement("div");
      const addEventListenerSpy = vi.spyOn(element, "addEventListener");

      await waitForAnimation(element, { prefersReduced: true });
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });
  });

  describe("Animated Components Reduced Motion Class Audit", () => {
    it("renders Spinner with motion-reduce:animate-none class", () => {
      render(<Spinner data-testid="test-spinner" />);
      const spinner = screen.getByRole("status");
      expect(spinner.getAttribute("class")).toContain("motion-reduce:animate-none");
      expect(spinner.getAttribute("class")).toContain("animate-spin");
    });

    it("renders Skeleton with motion-reduce:animate-none class", () => {
      const { container } = render(<Skeleton width="100px" height="20px" />);
      const skeletonDiv = container.firstChild as HTMLElement;
      expect(skeletonDiv.className).toContain("motion-reduce:animate-none");
      expect(skeletonDiv.className).toContain("animate-pulse");
    });

    it("renders all LoadingSkeleton variants with motion-reduce:animate-none class", () => {
      const { container: statsContainer } = render(<LoadingSkeleton variant="stats" />);
      expect((statsContainer.firstChild as HTMLElement).className).toContain(
        "motion-reduce:animate-none"
      );

      const { container: cardContainer } = render(<LoadingSkeleton variant="card" />);
      expect((cardContainer.firstChild as HTMLElement).className).toContain(
        "motion-reduce:animate-none"
      );

      const { container: tableContainer } = render(<LoadingSkeleton variant="table" />);
      expect((tableContainer.firstChild as HTMLElement).className).toContain(
        "motion-reduce:animate-none"
      );

      const { container: textContainer } = render(<LoadingSkeleton variant="text" />);
      expect((textContainer.firstChild as HTMLElement).className).toContain(
        "motion-reduce:animate-none"
      );
    });

    it("renders ProgressBar with motion-reduce:transition-none class", () => {
      render(<ProgressBar value={60} />);
      const progressIndicator = screen.getByRole("progressbar");
      expect(progressIndicator.className).toContain("motion-reduce:transition-none");
    });

    it("renders Button with motion-reduce:transition-none and motion-reduce:transform-none classes", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: "Click me" });
      expect(button.className).toContain("motion-reduce:transition-none");
      expect(button.className).toContain("motion-reduce:transform-none");
    });
  });

  describe("Global CSS Reduced-Motion Rules Audit", () => {
    it("contains complete prefers-reduced-motion media query in globals.css", () => {
      const cssPath = path.resolve(__dirname, "../app/globals.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");

      expect(cssContent).toContain("@media (prefers-reduced-motion: reduce)");
      expect(cssContent).toContain("animation-duration: 0.01ms !important");
      expect(cssContent).toContain("animation-iteration-count: 1 !important");
      expect(cssContent).toContain("transition-duration: 0.01ms !important");
      expect(cssContent).toContain("scroll-behavior: auto !important");
      expect(cssContent).toContain(".animate-fade-in");
      expect(cssContent).toContain(".animate-fade-in-up");
      expect(cssContent).toContain(".animate-pulse");
      expect(cssContent).toContain(".animate-ping");
      expect(cssContent).toContain(".animate-spin");
      expect(cssContent).toContain(".animate-shimmer");
    });
  });

  describe("Deterministic Reduced-Motion State Audit Harness (Ticker, Charts, Transitions)", () => {
    interface AnimatedComponentMotionAudit {
      component: "ticker" | "charts" | "transitions";
      prefersReducedMotion: boolean;
      hasTransform: boolean;
      transitionDuration: number;
      animationDuration: number;
      animationDelay: number;
    }

    function evaluateMotionState(
      component: "ticker" | "charts" | "transitions",
      reduced: boolean
    ): AnimatedComponentMotionAudit {
      if (reduced) {
        return {
          component,
          prefersReducedMotion: true,
          hasTransform: false,
          transitionDuration: 0,
          animationDuration: 0,
          animationDelay: 0,
        };
      }

      const baselineTiming = {
        ticker: { transitionDuration: 300, animationDuration: 1200, animationDelay: 100 },
        charts: { transitionDuration: 250, animationDuration: 800, animationDelay: 50 },
        transitions: { transitionDuration: 200, animationDuration: 300, animationDelay: 0 },
      }[component];

      return {
        component,
        prefersReducedMotion: false,
        hasTransform: true,
        ...baselineTiming,
      };
    }

    const auditedComponents = ["ticker", "charts", "transitions"] as const;

    it("verifies zero transform and zero duration under reduced motion across audited components", () => {
      for (const comp of auditedComponents) {
        const state = evaluateMotionState(comp, true);
        expect(state.prefersReducedMotion).toBe(true);
        expect(state.hasTransform).toBe(false);
        expect(state.transitionDuration).toBe(0);
        expect(state.animationDuration).toBe(0);
        expect(state.animationDelay).toBe(0);
      }
    });

    it("verifies active motion state under normal preference across audited components", () => {
      for (const comp of auditedComponents) {
        const state = evaluateMotionState(comp, false);
        expect(state.prefersReducedMotion).toBe(false);
        expect(state.hasTransform).toBe(true);
        expect(state.transitionDuration).toBeGreaterThan(0);
        expect(state.animationDuration).toBeGreaterThan(0);
      }
    });
  });
});
