// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import type { ReactNode } from "react";

const pathname = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...props }: { children: ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick} {...props}>{children}</a>
  ),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    pathname.value = "/";
  });

  it("closes the mobile drawer when the route changes", () => {
    const { rerender } = render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(document.querySelector("aside.lg\\:hidden")?.className).toContain("translate-x-0");

    pathname.value = "/payments";
    rerender(<Sidebar />);

    expect(document.querySelector("aside.lg\\:hidden")?.className).toContain("-translate-x-full");
  });

  it("labels navigation landmarks and keeps the closed mobile drawer inert", () => {
    render(<Sidebar />);

    expect(screen.getAllByRole("navigation", { name: "Primary navigation" })).toHaveLength(2);
    expect(screen.getByRole("complementary", { name: "Desktop sidebar" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Mobile sidebar" })).toHaveAttribute("inert");
  });

  it("exposes the mobile navigation state on its menu button", () => {
    render(<Sidebar />);
    const toggle = screen.getByRole("button", { name: "Toggle menu" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "mobile-navigation");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
