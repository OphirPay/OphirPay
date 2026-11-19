// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("offers download and copy actions when requested (issue #1375)", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    render(
      <QrCode
        value="web+stellar:pay?destination=GABC&amount=10"
        showActions
        downloadFileName="request.png"
      />
    );

    await screen.findByRole("img", { name: /qr code/i });
    expect(
      screen.getByRole("button", { name: /download png/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy payment uri/i })
    ).toBeInTheDocument();
  });

  it("renders a print-resolution PNG on download", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <QrCode
        value="web+stellar:pay?destination=GABC"
        showActions
        downloadFileName="request.png"
        downloadSize={800}
      />
    );

    await screen.findByRole("img", { name: /qr code/i });
    fireEvent.click(screen.getByRole("button", { name: /download png/i }));

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith(
        "web+stellar:pay?destination=GABC",
        expect.objectContaining({ width: 800 })
      )
    );
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    clickSpy.mockRestore();
  });
});
