// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyAmount } from "@/components/ui/CurrencyAmount";

describe("CurrencyAmount component", () => {
  it("renders amount in XLM mode formatted to 2 decimals with asset unit", () => {
    render(<CurrencyAmount amount={10.5} assetCode="XLM" currency="XLM" price={0.15} />);
    expect(screen.getByText("10.50 XLM")).toBeInTheDocument();
  });

  it("treats native assetCode as XLM", () => {
    render(<CurrencyAmount amount={25} assetCode="native" currency="XLM" price={0.15} />);
    expect(screen.getByText("25.00 XLM")).toBeInTheDocument();
  });

  it("renders non-convertible asset in its native token unit even in USD mode", () => {
    render(<CurrencyAmount amount={100} assetCode="USDC" currency="USD" price={0.15} />);
    expect(screen.getByText("100.00 USDC")).toBeInTheDocument();
    expect(screen.queryByText(/~\$/)).toBeNull();
  });

  it("converts XLM to USD and displays approximate fiat amount with original subtitle", () => {
    // 10 XLM * 0.15 USD/XLM = $1.50
    render(<CurrencyAmount amount={10} assetCode="XLM" currency="USD" price={0.15} />);
    expect(screen.getByText("~$1.50")).toBeInTheDocument();
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
  });

  it("respects showOriginal=false to omit the original XLM subtitle in USD mode", () => {
    render(
      <CurrencyAmount
        amount={10}
        assetCode="XLM"
        currency="USD"
        price={0.15}
        showOriginal={false}
      />
    );
    expect(screen.getByText("~$1.50")).toBeInTheDocument();
    expect(screen.queryByText("10.00 XLM")).toBeNull();
  });

  it("visibly falls back to asset unit and (USD unavailable) when price is null", () => {
    render(<CurrencyAmount amount={10} assetCode="XLM" currency="USD" price={null} />);
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
  });

  it("visibly falls back to asset unit and (USD unavailable) when isUnavailable is true", () => {
    render(
      <CurrencyAmount
        amount={10}
        assetCode="XLM"
        currency="USD"
        price={0.15}
        isUnavailable={true}
      />
    );
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
  });

  it("visibly falls back to asset unit and (USD unavailable) when price is undefined", () => {
    render(<CurrencyAmount amount={10} assetCode="XLM" currency="USD" price={undefined} />);
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
  });

  it("handles string amounts correctly", () => {
    render(<CurrencyAmount amount="42.5" assetCode="XLM" currency="XLM" price={0.15} />);
    expect(screen.getByText("42.50 XLM")).toBeInTheDocument();
  });

  it("renders dash for NaN or unparseable amount", () => {
    render(<CurrencyAmount amount="not_a_number" assetCode="XLM" currency="XLM" price={0.15} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
