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
});
