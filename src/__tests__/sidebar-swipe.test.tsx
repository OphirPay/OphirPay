// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { Sidebar } from "@/components/Sidebar";
import { MEDIA } from "@/lib/responsive";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

/** Reports the touch media query as matching (or not) for the whole file. */
function mockTouchDevice(isTouch: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === MEDIA.hasTouch ? isTouch : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function swipe(fromX: number, toX: number, y = 200) {
  // The listener lives on `document`, so the gesture is dispatched there.
  fireEvent.touchStart(document, {
    touches: [{ clientX: fromX, clientY: y }],
  });
  fireEvent.touchEnd(document, {
    changedTouches: [{ clientX: toX, clientY: y }],
  });
}

/** The mobile drawer is the only `aside` carrying the translate utility. */
function drawer() {
  return document.querySelector("aside.lg\\:hidden") as HTMLElement;
}

beforeEach(() => {
  mockTouchDevice(true);
});

describe("Sidebar swipe gestures (issue #1385)", () => {
  it("opens the drawer on a right swipe from the left edge", async () => {
    render(<Sidebar />);
    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));

    swipe(8, 120);

    await waitFor(() => expect(drawer().className).toContain("translate-x-0"));
    expect(screen.getByRole("button", { name: "Toggle menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("closes the open drawer on a left swipe", async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    await waitFor(() => expect(drawer().className).toContain("translate-x-0"));

    swipe(240, 120);

    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));
  });

  it("ignores a swipe that starts away from the edge while closed", async () => {
    render(<Sidebar />);
    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));

    // 200px in from the left: the gesture belongs to the content, not the nav.
    swipe(200, 320);

    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));
  });

  it("ignores a mostly-vertical gesture so scrolling never toggles the nav", async () => {
    render(<Sidebar />);
    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));

    fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 100 }] });
    fireEvent.touchEnd(document, {
      changedTouches: [{ clientX: 100, clientY: 400 }],
    });

    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));
  });

  it("does not install swipe handling on a non-touch device", async () => {
    mockTouchDevice(false);
    render(<Sidebar />);
    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));

    swipe(8, 120);

    expect(drawer().className).toContain("-translate-x-full");
  });

  it("keeps the backdrop mounted but inert while the drawer is closed", async () => {
    render(<Sidebar />);
    const backdrop = document.querySelector("div[aria-hidden='true'].lg\\:hidden");
    await waitFor(() => expect(backdrop?.className).toContain("opacity-0"));
    expect(backdrop?.className).toContain("pointer-events-none");
    expect(backdrop?.className).toContain("transition-opacity");

    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    await waitFor(() =>
      expect(
        document.querySelector("div[aria-hidden='true'].lg\\:hidden")?.className,
      ).toContain("opacity-100"),
    );
  });

  it("closes the drawer when the backdrop is clicked", async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    await waitFor(() => expect(drawer().className).toContain("translate-x-0"));

    fireEvent.click(
      document.querySelector("div[aria-hidden='true'].lg\\:hidden") as HTMLElement,
    );

    await waitFor(() => expect(drawer().className).toContain("-translate-x-full"));
  });
});
