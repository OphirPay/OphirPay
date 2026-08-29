// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";

const mockSetMobileOpen = vi.fn();
let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Minimal icon mocks so the component renders without pulling in the full icon set.
vi.mock("@/components/ui/Icon", () => ({
  DashboardIcon: () => <svg data-testid="DashboardIcon" />,
  SendIcon: () => <svg data-testid="SendIcon" />,
  PaymentsIcon: () => <svg data-testid="PaymentsIcon" />,
  BatchesIcon: () => <svg data-testid="BatchesIcon" />,
  RecurringIcon: () => <svg data-testid="RecurringIcon" />,
  RequestsIcon: () => <svg data-testid="RequestsIcon" />,
  WebhookIcon: () => <svg data-testid="WebhookIcon" />,
  ContractsIcon: () => <svg data-testid="ContractsIcon" />,
  AnalyticsIcon: () => <svg data-testid="AnalyticsIcon" />,
  EventsIcon: () => <svg data-testid="EventsIcon" />,
  MenuIcon: () => <svg data-testid="MenuIcon" />,
  XIcon: () => <svg data-testid="XIcon" />,
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders the mobile menu toggle", () => {
    render(<Sidebar />);
    expect(screen.getByLabelText("Toggle menu")).toBeDefined();
  });

  it("closes mobile sidebar when pathname changes", () => {
    const { rerender } = render(<Sidebar />);

    // Open the mobile menu
    fireEvent.click(screen.getByLabelText("Toggle menu"));

    // Simulate route change by updating the mocked pathname and re-rendering
    mockPathname = "/send";
    rerender(<Sidebar />);

    // After pathname change, the mobile sidebar should be hidden.
    // The mobile sidebar has the lg:hidden class and a translate-x class.
    const mobileSidebar = document.querySelector("aside.lg\\:hidden");
    expect(mobileSidebar).not.toBeNull();
    expect(mobileSidebar?.classList.contains("-translate-x-full")).toBe(true);
  });
});
