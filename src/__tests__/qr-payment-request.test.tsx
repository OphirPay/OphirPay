// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QrCode } from "@/components/ui/QrCode";
import { PaymentRequestModal } from "@/components/PaymentRequestModal";

const toDataURLMock = vi.fn();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURLMock(...args),
  },
}));

// Mock the SEP-7 builder so we control exactly what URI is produced
const buildSep7PayUriMock = vi.fn();

vi.mock("@/lib/stellar-uri", () => ({
  buildSep7PayUri: (...args: unknown[]) => buildSep7PayUriMock(...args),
}));

// Valid test address (56-char G address)
const VALID_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ12345";

beforeEach(() => {
  toDataURLMock.mockReset();
  buildSep7PayUriMock.mockReset();
});

// ── Plain QR mode (backward compatibility) ─────────────────────

describe("QrCode — plain mode", () => {
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

  it("shows an error state when generation fails", async () => {
    toDataURLMock.mockRejectedValue(new Error("boom"));
    render(<QrCode value="web+stellar:pay?destination=GABC" />);

    expect(
      await screen.findByRole("img", { name: /failed to generate/i })
    ).toBeInTheDocument();
  });

  it("does not show action buttons in plain mode", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    render(<QrCode value="web+stellar:pay?destination=GABC" />);
    await screen.findByRole("img");

    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy uri/i })).not.toBeInTheDocument();
  });
});

// ── Payment QR mode ──────────────────────────────────────────

describe("QrCode — payment mode", () => {
  const payment = {
    destination: VALID_ADDRESS,
    amount: "10.50",
    assetCode: "USDC",
    assetIssuer: VALID_ADDRESS,
    memo: "Test payment",
  };

  it("builds a SEP-7 URI via buildSep7PayUri", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=10.5");

    render(<QrCode payment={payment} />);

    await waitFor(() =>
      expect(buildSep7PayUriMock).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: VALID_ADDRESS,
          amount: "10.50",
          assetCode: "USDC",
          assetIssuer: VALID_ADDRESS,
          memo: "Test payment",
        })
      )
    );
  });

  it("generates QR from the built SEP-7 URI", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=10.5");

    render(<QrCode payment={payment} />);

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith(
        "web+stellar:pay?destination=GABC&amount=10.5",
        expect.objectContaining({ width: 220 })
      )
    );
  });

  it("shows a generating placeholder while payment URI is being built", () => {
    toDataURLMock.mockReturnValue(new Promise(() => {}));
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC");

    render(<QrCode payment={payment} />);
    expect(screen.getByRole("status", { name: /generating qr code/i })).toBeInTheDocument();
  });

  it("shows an error state when SEP-7 builder throws", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockImplementation(() => {
      throw new Error("Invalid address");
    });

    render(<QrCode payment={{ destination: "INVALID" }} />);

    expect(
      await screen.findByRole("img", { name: /failed to generate/i })
    ).toBeInTheDocument();
  });

  it("does not show action buttons by default", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC");

    render(<QrCode payment={payment} />);
    await screen.findByRole("img");

    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy uri/i })).not.toBeInTheDocument();
  });

  it("shows action buttons when showActions is true", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=10.5");

    render(<QrCode payment={payment} showActions />);

    await screen.findByRole("img");
    expect(screen.getByRole("button", { name: /download qr image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy uri/i })).toBeInTheDocument();
  });

  it("copies the URI to clipboard when Copy URI is clicked", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=10.5");

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<QrCode payment={payment} showActions />);

    const copyBtn = await screen.findByRole("button", { name: /copy uri/i });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("web+stellar:pay?destination=GABC&amount=10.5"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied!/i })).toBeInTheDocument()
    );
  });

  it("regenerates when payment params change", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=10.5");

    const { rerender } = render(<QrCode payment={payment} />);
    await screen.findByRole("img");

    const newPayment = { ...payment, amount: "20.00" };
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC&amount=20");

    rerender(<QrCode payment={newPayment} />);

    await waitFor(() =>
      expect(buildSep7PayUriMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ amount: "20.00" })
      )
    );
  });
});

// ── PaymentRequestModal ──────────────────────────────────────

describe("PaymentRequestModal", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };

  it("renders the modal with form fields", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    expect(screen.getByLabelText(/destination address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^asset$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/memo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate request/i })).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    const { container } = render(<PaymentRequestModal {...defaultProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows validation error for empty destination", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: /generate request/i }));

    expect(screen.getByText(/destination address is required/i)).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("shows validation error for invalid destination", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: { value: "INVALID" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate request/i }));

    expect(screen.getByText(/invalid stellar address/i)).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("shows validation error for non-native asset without issuer", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByLabelText(/^asset$/i), {
      target: { value: "USDC" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate request/i }));

    expect(screen.getByText(/asset issuer is required/i)).toBeInTheDocument();
    expect(defaultProps.onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with valid form data", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: "25.50" },
    });
    fireEvent.change(screen.getByLabelText(/memo/i), {
      target: { value: "Invoice #123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate request/i }));

    expect(defaultProps.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: VALID_ADDRESS,
        amount: "25.50",
        assetCode: "XLM",
        assetIssuer: "",
        memo: "Invoice #123",
      })
    );
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("hides issuer field for native XLM asset", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/^asset$/i), {
      target: { value: "XLM" },
    });

    expect(screen.queryByLabelText(/asset issuer/i)).not.toBeInTheDocument();
  });

  it("shows issuer field for non-native asset", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/^asset$/i), {
      target: { value: "USDC" },
    });

    expect(screen.getByLabelText(/asset issuer/i)).toBeInTheDocument();
  });

  it("renders QR preview when destination is valid", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
    buildSep7PayUriMock.mockReturnValue("web+stellar:pay?destination=GABC");

    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: { value: VALID_ADDRESS },
    });

    await screen.findByRole("img", { name: /payment request qr code/i });
  });

  it("does not render QR preview when destination is invalid", () => {
    render(<PaymentRequestModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/destination address/i), {
      target: { value: "INVALID" },
    });

    expect(screen.queryByRole("img", { name: /payment request/i })).not.toBeInTheDocument();
  });
});
