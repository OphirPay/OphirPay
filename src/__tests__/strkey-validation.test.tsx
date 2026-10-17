// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Keypair } from "@stellar/stellar-sdk";
import {
  validateStellarAddress,
  getFieldError,
} from "@/lib/validation-helpers";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ToastProvider } from "@/components/ui/Toast";
import SendPage from "@/app/send/page";
import { saveAddress } from "@/lib/address-book";

const VALID_KEY_1 = Keypair.random().publicKey();
const VALID_KEY_2 = Keypair.random().publicKey();
const SENDER_KEY = Keypair.random().publicKey();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/send",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: SENDER_KEY,
      balance: "500.00",
      network: "TESTNET",
      activeWalletId: "freighter",
    },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/lib/wallets", () => ({
  getWalletConnector: () => ({
    signTransaction: vi.fn().mockResolvedValue("SIGNED_XDR"),
  }),
}));

vi.mock("@/lib/fee-estimator", () => ({
  estimateTransactionFee: vi.fn().mockResolvedValue({
    baseFee: "100",
    recommendedFee: "100",
    networkCongestion: "low",
    basis: "p90",
    stale: false,
  }),
}));

vi.mock("@/components/AssetSelector", () => ({
  AssetSelector: () => <div data-testid="asset-selector" />,
}));

function renderSendPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SendPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("validateStellarAddress (StrKey helper)", () => {
  it("accepts a valid 56-character G... Ed25519 public key", () => {
    const result = validateStellarAddress(VALID_KEY_1);
    expect(result).toEqual({
      valid: true,
      reason: null,
      error: null,
    });
    expect(getFieldError("stellarAddress", VALID_KEY_1)).toBeNull();
  });

  it("rejects empty or whitespace-only input", () => {
    const result = validateStellarAddress("   ");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("empty");
    expect(result.error).toMatch(/required/i);
  });

  it("rejects addresses that do not start with G (wrong prefix)", () => {
    const secretKey = Keypair.random().secret();
    const result = validateStellarAddress(secretKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("wrong_prefix");
    expect(result.error).toMatch(/must start with G/i);
  });

  it("rejects addresses whose length is not 56 characters", () => {
    const shortKey = VALID_KEY_1.slice(0, 40);
    const result = validateStellarAddress(shortKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("wrong_length");
    expect(result.error).toMatch(/56 characters/i);
  });

  it("rejects 56-character G... addresses that fail the StrKey CRC16 checksum", () => {
    const lastChar = VALID_KEY_1[55] === "A" ? "B" : "A";
    const badCrcKey = VALID_KEY_1.slice(0, 55) + lastChar;
    const result = validateStellarAddress(badCrcKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_checksum");
    expect(result.error).toMatch(/checksum/i);
  });
});

describe("AddressAutocomplete StrKey inline feedback", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("displays inline warning on wrong prefix, wrong length, and invalid CRC checksum", () => {
    let val = "";
    const { rerender } = render(
      <ToastProvider>
        <AddressAutocomplete
          value={val}
          onChange={(next) => {
            val = next;
          }}
        />
      </ToastProvider>
    );

    // Wrong prefix
    rerender(
      <ToastProvider>
        <AddressAutocomplete value="SABC123" onChange={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByTestId("strkey-validation-warning")).toHaveTextContent(
      /must start with G/i
    );
    expect(
      screen.queryByTestId("strkey-valid-indicator")
    ).not.toBeInTheDocument();

    // Wrong length
    rerender(
      <ToastProvider>
        <AddressAutocomplete value="GABC12345" onChange={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByTestId("strkey-validation-warning")).toHaveTextContent(
      /56 characters/i
    );

    // Failed CRC checksum (56 chars starting with G)
    const badCrc =
      VALID_KEY_1.slice(0, 55) + (VALID_KEY_1[55] === "A" ? "B" : "A");
    rerender(
      <ToastProvider>
        <AddressAutocomplete value={badCrc} onChange={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByTestId("strkey-validation-warning")).toHaveTextContent(
      /checksum/i
    );
  });

  it("shows green checkmark indicator when a valid 56-character G... key is entered", () => {
    render(
      <ToastProvider>
        <AddressAutocomplete value={VALID_KEY_1} onChange={() => {}} />
      </ToastProvider>
    );
    expect(screen.getByTestId("strkey-valid-indicator")).toBeInTheDocument();
    expect(
      screen.queryByTestId("strkey-validation-warning")
    ).not.toBeInTheDocument();
  });

  it("validates on blur when input is empty and preserves address book autocomplete", () => {
    saveAddress({ publicKey: VALID_KEY_2, label: "Treasury Vault" });
    let current = "";
    const { rerender } = render(
      <ToastProvider>
        <AddressAutocomplete
          value={current}
          onChange={(v) => {
            current = v;
          }}
        />
      </ToastProvider>
    );

    const input = screen.getByRole("combobox");
    fireEvent.blur(input);
    expect(screen.getByTestId("strkey-validation-warning")).toHaveTextContent(
      /required/i
    );

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Treasury" } });
    rerender(
      <ToastProvider>
        <AddressAutocomplete
          value={current}
          onChange={(v) => {
            current = v;
          }}
        />
      </ToastProvider>
    );
    expect(screen.getByText("Treasury Vault")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Treasury Vault"));
    expect(current).toBe(VALID_KEY_2);
  });
});

describe("SendPage submit button StrKey gating", () => {
  it("disables the submit button until destination passes StrKey validation", () => {
    renderSendPage();

    const destInput = screen.getByTestId("destination-input");
    const sendBtn = screen.getByTestId("send-btn");

    // Initially empty -> disabled
    expect(sendBtn).toBeDisabled();

    // Invalid CRC checksum -> disabled + inline warning shown
    const badCrc =
      VALID_KEY_1.slice(0, 55) + (VALID_KEY_1[55] === "A" ? "B" : "A");
    fireEvent.change(destInput, { target: { value: badCrc } });
    expect(sendBtn).toBeDisabled();
    expect(screen.getByTestId("strkey-validation-warning")).toHaveTextContent(
      /checksum/i
    );

    // Valid StrKey -> enabled + green checkmark shown
    fireEvent.change(destInput, { target: { value: VALID_KEY_1 } });
    expect(sendBtn).not.toBeDisabled();
    expect(screen.getByTestId("strkey-valid-indicator")).toBeInTheDocument();
  });
});
