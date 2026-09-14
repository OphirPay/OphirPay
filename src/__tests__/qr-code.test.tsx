// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QrCode } from "@/components/ui/QrCode";

const toDataURLMock = vi.fn();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURLMock(...args),
  },
}));

beforeEach(() => {
  toDataURLMock.mockReset();
});

describe("QrCode", () => {
  it("shows a generating placeholder until the QR is ready", () => {
    toDataURLMock.mockReturnValue(new Promise(() => {}));
    render(<QrCode value="web+stellar:pay?destination=GABC" />);
    expect(screen.getByRole("status", { name: /generating qr code/i })).toBeInTheDocument();
  });

  it("renders the generated QR as an image with alt text", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    render(<QrCode value="web+stellar:pay?destination=GABC" title="Receive QR code" />);

    const img = await screen.findByRole("img", { name: /receive qr code/i });
    expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(toDataURLMock).toHaveBeenCalledWith(
      "web+stellar:pay?destination=GABC",
      expect.objectContaining({ width: 220 })
    );
  });

  it("regenerates the QR when the value changes", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    const { rerender } = render(<QrCode value="web+stellar:pay?destination=GABC" />);
    await screen.findByRole("img");

    rerender(<QrCode value="web+stellar:pay?destination=GDEF" />);

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith(
        "web+stellar:pay?destination=GDEF",
        expect.any(Object)
      )
    );
  });

  it("does not regenerate when an unrelated prop changes", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    const { rerender } = render(<QrCode value="web+stellar:pay?destination=GABC" size={220} />);
    await screen.findByRole("img");

    rerender(<QrCode value="web+stellar:pay?destination=GABC" size={240} />);

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith(
        "web+stellar:pay?destination=GABC",
        expect.objectContaining({ width: 240 })
      )
    );
  });

  it("shows an error state when generation fails", async () => {
    toDataURLMock.mockRejectedValue(new Error("boom"));
    render(<QrCode value="web+stellar:pay?destination=GABC" />);

    expect(
      await screen.findByRole("img", { name: /failed to generate/i })
    ).toBeInTheDocument();
  });
});
