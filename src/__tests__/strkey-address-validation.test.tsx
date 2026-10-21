// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { validateStellarAddress } from "@/lib/validation-helpers";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { ToastProvider } from "@/components/ui/Toast";
import { StrKey } from "@stellar/stellar-sdk";

// Valid Stellar Ed25519 public keys
const VALID_ADDR_1 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_ADDR_2 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

// Invalid addresses
const SECRET_KEY = "SDJLWIK62P5Y7Z4QZ5H5NYB5QNZ4Z5NYB5QNZ4Z5NYB5QNZ4Z5NYB5QN"; // Starts with S
const CONTRACT_ID = "CA3D5KRYMCMCZVACQ3QBH7A52NWYGCNOJOCEB22OISFEHSPIKEAZNPWF"; // Starts with C
const SHORT_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFL"; // 55 chars
const LONG_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5EXTRA"; // 61 chars
// 56 characters starting with G, but corrupted checksum at the end
const CORRUPT_CRC_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA0";

describe("validateStellarAddress pure helper", () => {
  it("returns pristine state (isValid=false, error=null) for empty or whitespace-only strings", () => {
    expect(validateStellarAddress("")).toEqual({ isValid: false, error: null });
    expect(validateStellarAddress("   ")).toEqual({ isValid: false, error: null });
  });

  it("accepts valid 56-character Ed25519 public keys starting with G", () => {
    expect(StrKey.isValidEd25519PublicKey(VALID_ADDR_1)).toBe(true);
    const res1 = validateStellarAddress(VALID_ADDR_1);
    expect(res1.isValid).toBe(true);
    expect(res1.error).toBeNull();

    expect(StrKey.isValidEd25519PublicKey(VALID_ADDR_2)).toBe(true);
    const res2 = validateStellarAddress(`  ${VALID_ADDR_2}  `);
    expect(res2.isValid).toBe(true);
    expect(res2.error).toBeNull();
  });

  it("rejects addresses not starting with G with an informative prefix error", () => {
    const resSecret = validateStellarAddress(SECRET_KEY);
    expect(resSecret.isValid).toBe(false);
    expect(resSecret.error).toBe("Stellar public key must start with 'G'");

    const resContract = validateStellarAddress(CONTRACT_ID);
    expect(resContract.isValid).toBe(false);
    expect(resContract.error).toBe("Stellar public key must start with 'G'");

    const resEth = validateStellarAddress("0x71C8fb86633C6674B3E03417937A0F");
    expect(resEth.isValid).toBe(false);
    expect(resEth.error).toBe("Stellar public key must start with 'G'");
  });

  it("rejects addresses with incorrect length with current length readout", () => {
    const resShort = validateStellarAddress(SHORT_ADDR);
    expect(resShort.isValid).toBe(false);
    expect(resShort.error).toBe(`Stellar public key must be exactly 56 characters (currently ${SHORT_ADDR.length})`);

    const resLong = validateStellarAddress(LONG_ADDR);
    expect(resLong.isValid).toBe(false);
    expect(resLong.error).toBe(`Stellar public key must be exactly 56 characters (currently ${LONG_ADDR.length})`);
  });

  it("rejects 56-character keys with corrupted checksums", () => {
    expect(CORRUPT_CRC_ADDR.length).toBe(56);
    expect(CORRUPT_CRC_ADDR.startsWith("G")).toBe(true);
    const res = validateStellarAddress(CORRUPT_CRC_ADDR);
    expect(res.isValid).toBe(false);
    expect(res.error).toBe("Invalid Stellar address checksum (CRC check failed)");
  });
});

describe("AddressAutocomplete inline validation integration", () => {
  function TestHarness({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    const validation = validateStellarAddress(value);

    return (
      <ToastProvider>
        <div>
          <AddressAutocomplete
            value={value}
            onChange={setValue}
            showValidation={value.trim().length > 0}
            isValid={validation.isValid}
            validationError={validation.error}
            data-testid="test-address-input"
          />
          {value.trim().length > 0 && validation.error && (
            <p data-testid="address-inline-error">{validation.error}</p>
          )}
          {value.trim().length > 0 && validation.isValid && (
            <p data-testid="address-valid-text">Valid Stellar public key</p>
          )}
          <button disabled={!validation.isValid} data-testid="submit-btn">
            Send Payment
          </button>
        </div>
      </ToastProvider>
    );
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("disables submit and displays no error for empty initial state", () => {
    render(<TestHarness />);
    const submitBtn = screen.getByTestId("submit-btn");
    expect(submitBtn).toBeDisabled();
    expect(screen.queryByTestId("address-valid-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("address-inline-error")).not.toBeInTheDocument();
  });

  it("shows immediate inline error and keeps button disabled when typing non-G address", async () => {
    render(<TestHarness />);
    const input = screen.getByTestId("test-address-input");
    const submitBtn = screen.getByTestId("submit-btn");

    await userEvent.type(input, "0x1234");
    expect(submitBtn).toBeDisabled();
    expect(screen.getByTestId("address-inline-error")).toHaveTextContent("must start with 'G'");
    expect(screen.queryByTestId("address-valid-indicator")).not.toBeInTheDocument();
  });

  it("shows length counter error while typing partial address", async () => {
    render(<TestHarness />);
    const input = screen.getByTestId("test-address-input");
    const submitBtn = screen.getByTestId("submit-btn");

    await userEvent.type(input, "GABC123");
    expect(submitBtn).toBeDisabled();
    expect(screen.getByTestId("address-inline-error")).toHaveTextContent(
      "must be exactly 56 characters (currently 7)"
    );
    expect(screen.queryByTestId("address-valid-indicator")).not.toBeInTheDocument();
  });

  it("shows CRC checksum error when 56 characters have corrupted checksum", async () => {
    render(<TestHarness />);
    const input = screen.getByTestId("test-address-input");
    const submitBtn = screen.getByTestId("submit-btn");

    fireEvent.change(input, { target: { value: CORRUPT_CRC_ADDR } });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByTestId("address-inline-error")).toHaveTextContent(
      "checksum (CRC check failed)"
    );
    expect(screen.queryByTestId("address-valid-indicator")).not.toBeInTheDocument();
  });

  it("shows visual checkmark, success text, and enables submit button for valid public key", async () => {
    render(<TestHarness />);
    const input = screen.getByTestId("test-address-input");
    const submitBtn = screen.getByTestId("submit-btn");

    fireEvent.change(input, { target: { value: VALID_ADDR_1 } });
    expect(submitBtn).toBeEnabled();
    expect(screen.queryByTestId("address-inline-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("address-valid-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("address-valid-text")).toHaveTextContent("Valid Stellar public key");
  });
});
