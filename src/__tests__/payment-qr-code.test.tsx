// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QrCode } from "@/components/ui/QrCode";
import { PaymentRequestModal } from "@/components/payments/PaymentRequestModal";

// Mock QRCode.toDataURL to return a dummy base64 string
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,dummyQrCodeData"),
  },
}));

describe("QrCode Component", () => {
  it("renders QR image and action buttons when enabled", async () => {
    render(
      <QrCode
        value="web+stellar:pay?destination=GABC123"
        allowDownload
        showCopy
        title="Test QR"
      />
    );

    const img = await screen.findByAltText("Test QR");
    expect(img).toBeDefined();
    expect(screen.getByText("Download QR")).toBeDefined();
    expect(screen.getByText("URI")).toBeDefined();
  });
});

describe("PaymentRequestModal Component", () => {
  const sampleRequest = {
    id: "req-12345678",
    amount: "50",
    assetCode: "XLM",
    description: "Invoice #101 Consulting",
    recipientAddress: "GABCD5678WXYZ1234GABCD5678WXYZ1234GABCD5678WXYZ1234GABCD5678",
  };

  it("renders modal with SEP-0007 URI and allows tab switching", async () => {
    const handleClose = vi.fn();

    render(
      <PaymentRequestModal
        open={true}
        onClose={handleClose}
        request={sampleRequest}
      />
    );

    expect(screen.getByText("Payment QR Code")).toBeDefined();
    expect(screen.getByText(/50[.,]00\s+XLM/)).toBeDefined();
    expect(screen.getByText("Invoice #101 Consulting")).toBeDefined();
    expect(screen.getByText("Stellar Wallet (SEP-0007)")).toBeDefined();
    expect(screen.getByText("Web Payment Link")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByAltText(/Payment QR Code/)).toBeDefined();
    });

    // Toggle tab to Web Payment Link
    fireEvent.click(screen.getByText("Web Payment Link"));
    expect(screen.getByText(/pay\/GABCD5678/)).toBeDefined();

    // Click Done button
    fireEvent.click(screen.getByText("Done"));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
