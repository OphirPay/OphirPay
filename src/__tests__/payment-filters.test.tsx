// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { PaymentFilters } from "@/components/payments/PaymentFilters";

function renderFilters(overrides: Partial<ComponentProps<typeof PaymentFilters>> = {}) {
  const props = {
    search: "",
    onSearchChange: vi.fn(),
    status: "",
    onStatusChange: vi.fn(),
    dateFrom: "",
    onDateFromChange: vi.fn(),
    dateTo: "",
    onDateToChange: vi.fn(),
    asset: "",
    onAssetChange: vi.fn(),
    assetOptions: ["USDC", "XLM"],
    onClear: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PaymentFilters {...props} />) };
}

describe("PaymentFilters (issue #1382)", () => {
  it("reports every keystroke without waiting for a debounce", () => {
    const onSearchChange = vi.fn();
    renderFilters({ onSearchChange });

    fireEvent.change(screen.getByPlaceholderText(/search by address/i), {
      target: { value: "GABC" },
    });

    expect(onSearchChange).toHaveBeenCalledWith("GABC");
  });

  it("labels the search box so it is reachable by an accessible name", () => {
    renderFilters();
    expect(screen.getByRole("textbox", { name: "Search payments" })).toBeDefined();
  });

  it("exposes the status and date controls under their existing labels", () => {
    renderFilters();

    expect(screen.getByRole("combobox", { name: "Status filter" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Asset filter" })).toBeDefined();
    expect(screen.getByLabelText("Filter from date")).toBeDefined();
    expect(screen.getByLabelText("Filter to date")).toBeDefined();
  });

  it("bubbles status, date and asset changes so the page can sync the URL", () => {
    const onStatusChange = vi.fn();
    const onDateFromChange = vi.fn();
    const onAssetChange = vi.fn();
    renderFilters({ onStatusChange, onDateFromChange, onAssetChange });

    fireEvent.change(screen.getByRole("combobox", { name: "Status filter" }), {
      target: { value: "CANCELLED" },
    });
    fireEvent.change(screen.getByLabelText("Filter from date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset filter" }), {
      target: { value: "USDC" },
    });

    expect(onStatusChange).toHaveBeenCalledWith("CANCELLED");
    expect(onDateFromChange).toHaveBeenCalledWith("2026-01-01");
    expect(onAssetChange).toHaveBeenCalledWith("USDC");
  });

  it("lists the asset options it is given", () => {
    renderFilters({ assetOptions: ["EURC", "USDC"] });

    expect(screen.getByRole("option", { name: "EURC" })).toBeDefined();
    expect(screen.getByRole("option", { name: "USDC" })).toBeDefined();
  });

  it("hides the clear-all action until at least one filter is active", () => {
    const { props } = renderFilters();
    expect(screen.queryByRole("button", { name: /clear filters/i })).toBeNull();
    expect(props.onClear).not.toHaveBeenCalled();
  });

  it("shows clear-all for a search box that is not yet flushed to the URL", () => {
    // The page only writes `q` to the URL after the debounce, so the button
    // must key off the immediate search value — otherwise a user who types and
    // pauses cannot clear what they see.
    renderFilters({ search: "GABC" });

    const clear = screen.getByRole("button", { name: /clear filters/i });
    fireEvent.click(clear);
    expect(clear).toBeDefined();
  });

  it("calls onClear from the clear-all button", () => {
    const onClear = vi.fn();
    renderFilters({ status: "RECORDED", onClear });

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
