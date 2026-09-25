// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const view = fs.readFileSync(path.join(root, "src/app/payments/[id]/PaymentDetailView.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");

describe("payment detail print styles", () => {
  it("marks the payment detail page as the printable region", () => {
    expect(view).toContain("ophir-print-payment-detail");
    expect(view).toContain("aria-label=\"Printable payment details\"");
    expect(view).toContain("print:hidden");
  });

  it("prints the full transaction hash instead of the shortened display hash", () => {
    expect(view).toContain("<span className=\"print:hidden\">{shortenAddress(payment.transactionHash)}</span>");
    expect(view).toContain("<span className=\"hidden print:inline\">{payment.transactionHash}</span>");
    expect(view).toContain("print:break-all");
  });

  it("forces print-safe colors, hides app chrome and avoids page breaks inside detail rows", () => {
    expect(css).toContain("@media print");
    expect(css).toContain("nav,");
    expect(css).toContain("aside,");
    expect(css).toContain("button,");
    expect(css).toContain("background: #ffffff !important");
    expect(css).toContain("color: #111827 !important");
    expect(css).toContain("break-inside: avoid");
  });
});
