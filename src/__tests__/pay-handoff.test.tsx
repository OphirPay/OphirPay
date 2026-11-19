// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PayHandoff } from "@/app/pay/[address]/PayHandoff";

describe("PayHandoff", () => {
  it("offers both SEP-7 wallet-app and browser-wallet payment links", () => {
    render(
      <PayHandoff
        paymentUri="web+stellar:pay?destination=G..."
        sendHref="/send?dest=G..."
      />,
    );

    expect(screen.getByRole("link", { name: "Open in Stellar wallet" })).toHaveAttribute(
      "href",
      "web+stellar:pay?destination=G...",
    );
    expect(screen.getByRole("link", { name: "Pay with browser wallet" })).toHaveAttribute(
      "href",
      "/send?dest=G...",
    );
    expect(screen.getByText(/SEP-7 compatible wallet app/i)).toBeInTheDocument();
  });
});
