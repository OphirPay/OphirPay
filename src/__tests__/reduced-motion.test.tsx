// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { Spinner } from "@/components/ui/Spinner";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { usePrefersReducedMotion } from "@/lib/reduced-motion";

describe("Reduced Motion Accessibility Audit (prefers-reduced-motion)", () => {
  it("defines comprehensive prefers-reduced-motion overrides in globals.css", () => {
    const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    expect(cssContent).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssContent).toContain("animation-duration: 0.01ms !important");
    expect(cssContent).toContain("scroll-behavior: auto !important");
    expect(cssContent).toContain(".animate-fade-in");
    expect(cssContent).toContain(".animate-fade-in-up");
    expect(cssContent).toContain(".animate-shimmer");
  });

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
    const { container: textContainer } = render(<LoadingSkeleton variant="text" />);
    expect((textContainer.firstChild as HTMLElement).className).toContain("motion-reduce:animate-none");

    const { container: cardContainer } = render(<LoadingSkeleton variant="card" />);
    expect((cardContainer.firstChild as HTMLElement).className).toContain("motion-reduce:animate-none");

    const { container: tableContainer } = render(<LoadingSkeleton variant="table" />);
    expect((tableContainer.firstChild as HTMLElement).className).toContain("motion-reduce:animate-none");

    const { container: statsContainer } = render(<LoadingSkeleton variant="stats" />);
    expect((statsContainer.firstChild as HTMLElement).className).toContain("motion-reduce:animate-none");
  });

  it("evaluates usePrefersReducedMotion hook reactively", () => {
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = mockMatchMedia;

    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(mockMatchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });
});
