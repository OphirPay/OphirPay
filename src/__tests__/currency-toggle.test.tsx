// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { CurrencyToggle } from "@/components/ui/CurrencyToggle";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay";
import { useXlmPrice } from "@/hooks/usePrice";
import * as priceModule from "@/lib/price";

describe("CurrencyToggle Component", () => {
  it("renders both XLM and USD toggle buttons", () => {
    render(<CurrencyToggle value="XLM" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /display amounts in xlm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /display amounts in usd/i })).toBeInTheDocument();
  });

  it("sets aria-pressed correctly based on value", () => {
    const { rerender } = render(<CurrencyToggle value="XLM" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /display amounts in xlm/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /display amounts in usd/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    rerender(<CurrencyToggle value="USD" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /display amounts in xlm/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: /display amounts in usd/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    render(<CurrencyToggle value="XLM" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /display amounts in usd/i }));
    expect(onChange).toHaveBeenCalledWith("USD");

    fireEvent.click(screen.getByRole("button", { name: /display amounts in xlm/i }));
    expect(onChange).toHaveBeenCalledWith("XLM");
  });

  it("disables buttons when disabled prop is true", () => {
    render(<CurrencyToggle value="XLM" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /display amounts in xlm/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /display amounts in usd/i })).toBeDisabled();
  });

  it("displays price preview when showPrice is true and price is available", () => {
    render(<CurrencyToggle value="USD" onChange={vi.fn()} showPrice={true} price={0.125} />);
    expect(screen.getByText("($0.13)")).toBeInTheDocument();
  });

  it("displays unavailable indicator when showPrice is true and price is unavailable", () => {
    render(<CurrencyToggle value="USD" onChange={vi.fn()} showPrice={true} isUnavailable={true} />);
    expect(screen.getByTitle("Price feed unavailable")).toBeInTheDocument();
  });
});

describe("useCurrencyDisplay Hook", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to XLM", () => {
    const { result } = renderHook(() => useCurrencyDisplay());
    expect(result.current.currency).toBe("XLM");
    expect(result.current.isXlm).toBe(true);
    expect(result.current.isUsd).toBe(false);
  });

  it("updates currency and persists to localStorage", () => {
    const { result } = renderHook(() => useCurrencyDisplay());

    act(() => {
      result.current.setCurrency("USD");
    });

    expect(result.current.currency).toBe("USD");
    expect(result.current.isUsd).toBe(true);
    expect(result.current.isXlm).toBe(false);
    expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe(
      "USD"
    );
  });

  it("toggles between XLM and USD", () => {
    const { result } = renderHook(() => useCurrencyDisplay());

    act(() => {
      result.current.toggleCurrency();
    });
    expect(result.current.currency).toBe("USD");

    act(() => {
      result.current.toggleCurrency();
    });
    expect(result.current.currency).toBe("XLM");
  });

  it("falls back to defaultCurrency when localStorage contains invalid value", () => {
    window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("INVALID_CURRENCY"));
    const { result } = renderHook(() => useCurrencyDisplay("XLM"));

    expect(result.current.currency).toBe("XLM");
    expect(result.current.isXlm).toBe(true);
    expect(result.current.isUsd).toBe(false);

    act(() => {
      result.current.toggleCurrency();
    });
    expect(result.current.currency).toBe("USD");
  });
});

describe("useXlmPrice Hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches price on mount", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
      timestamp: Date.now(),
    });

    const { result } = renderHook(() => useXlmPrice());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.price).toBe(0.15);
    expect(result.current.isUnavailable).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("handles unavailable price error state", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: null,
      source: null,
      error: "Sources down",
    });

    const { result } = renderHook(() => useXlmPrice());

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.price).toBeNull();
    expect(result.current.isUnavailable).toBe(true);
    expect(result.current.error).toBe("Sources down");
  });

  it("handles unexpected thrown errors gracefully", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockRejectedValue(new Error("Unexpected crash"));

    const { result } = renderHook(() => useXlmPrice({ enabled: false }));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.price).toBeNull();
    expect(result.current.error).toBe("Unexpected crash");
    expect(result.current.isLoading).toBe(false);
  });

  it("supports periodic polling when pollInterval is set", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.2,
      source: "coingecko",
      timestamp: Date.now(),
    });

    const { unmount } = renderHook(() => useXlmPrice({ pollInterval: 5000 }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    unmount();
    vi.useRealTimers();
  });
});
