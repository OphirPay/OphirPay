// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";

describe("CurrencyToggle Component", () => {
  it("renders both XLM and USD options in an accessible group", () => {
    const onChange = vi.fn();
    render(<CurrencyToggle value="XLM" onChange={onChange} />);

    const group = screen.getByRole("group", { name: /currency display toggle/i });
    expect(group).toBeInTheDocument();

    const xlmButton = screen.getByRole("radio", { name: /display in xlm/i });
    const usdButton = screen.getByRole("radio", { name: /display in usd/i });

    expect(xlmButton).toBeInTheDocument();
    expect(usdButton).toBeInTheDocument();
  });

  it("indicates active state using aria-checked", () => {
    const { rerender } = render(<CurrencyToggle value="XLM" onChange={vi.fn()} />);

    let xlmButton = screen.getByRole("radio", { name: /display in xlm/i });
    let usdButton = screen.getByRole("radio", { name: /display in usd/i });

    expect(xlmButton).toHaveAttribute("aria-checked", "true");
    expect(usdButton).toHaveAttribute("aria-checked", "false");

    rerender(<CurrencyToggle value="USD" onChange={vi.fn()} />);

    xlmButton = screen.getByRole("radio", { name: /display in xlm/i });
    usdButton = screen.getByRole("radio", { name: /display in usd/i });

    expect(xlmButton).toHaveAttribute("aria-checked", "false");
    expect(usdButton).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with 'USD' when clicking the USD button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CurrencyToggle value="XLM" onChange={onChange} />);

    const usdButton = screen.getByRole("radio", { name: /display in usd/i });
    await user.click(usdButton);

    expect(onChange).toHaveBeenCalledWith("USD");
  });

  it("calls onChange with 'XLM' when clicking the XLM button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CurrencyToggle value="USD" onChange={onChange} />);

    const xlmButton = screen.getByRole("radio", { name: /display in xlm/i });
    await user.click(xlmButton);

    expect(onChange).toHaveBeenCalledWith("XLM");
  });

  it("disables buttons when disabled prop is true", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CurrencyToggle value="XLM" onChange={onChange} disabled={true} />);

    const usdButton = screen.getByRole("radio", { name: /display in usd/i });
    expect(usdButton).toBeDisabled();

    await user.click(usdButton);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows price conversion tooltip title when priceRate is provided", () => {
    render(<CurrencyToggle value="XLM" onChange={vi.fn()} priceRate={0.1234} />);

    const usdButton = screen.getByRole("radio", { name: /display in usd/i });
    expect(usdButton).toHaveAttribute("title", "1 XLM ≈ $0.1234");
  });
});
