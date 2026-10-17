// SPDX-License-Identifier: MIT

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  addContactWithConflictCheck,
  checkAddressTrustStatus,
  detectContactConflict,
  findContactByAddress,
  findContactByAlias,
  getAddressBook,
  markAddressBlacklisted,
  saveAddress,
  searchAddressBook,
} from "@/lib/address-book";
import { PaymentForm } from "@/components/forms/payment-form";
import { ContactCard } from "@/components/address-book/contact-card";

const ADDR_ALICE = "G" + "A".repeat(55);
const ADDR_BOB = "G" + "B".repeat(55);
const ADDR_CHARLIE = "G" + "C".repeat(55);

describe("address-book lookup, deduplication, and payment-form integration (#1316)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("searches contacts by name, federation address, and public key prefix", () => {
    saveAddress({
      publicKey: ADDR_ALICE,
      label: "Alice Treasury",
      federationAddress: "alice*ophirpay.com",
      memo: "INV-100",
    });
    saveAddress({
      publicKey: ADDR_BOB,
      label: "Bob Payroll",
      federationAddress: "bob*stellar.org",
    });

    expect(searchAddressBook("treasury").map((c) => c.publicKey)).toEqual([
      ADDR_ALICE,
    ]);
    expect(searchAddressBook("alice*ophirpay").map((c) => c.publicKey)).toEqual([
      ADDR_ALICE,
    ]);
    expect(
      searchAddressBook(ADDR_BOB.slice(0, 8)).map((c) => c.publicKey)
    ).toEqual([ADDR_BOB]);
  });

  it("prevents duplicate public keys and colliding aliases with conflict details", () => {
    const first = addContactWithConflictCheck({
      publicKey: ADDR_ALICE,
      label: "Alice",
      memo: "Memo-1",
    });
    expect(first.ok).toBe(true);
    expect(getAddressBook()).toHaveLength(1);

    // Duplicate public key with different alias
    const dupAddress = addContactWithConflictCheck({
      publicKey: ADDR_ALICE,
      label: "Alice Secondary",
    });
    expect(dupAddress.ok).toBe(false);
    expect(dupAddress.conflict?.type).toBe("duplicate_address");
    expect(dupAddress.error).toMatch(/already saved under "Alice"/i);

    // Colliding alias (case-insensitive) with different public key
    const dupAlias = addContactWithConflictCheck({
      publicKey: ADDR_BOB,
      label: "alice",
    });
    expect(dupAlias.ok).toBe(false);
    expect(dupAlias.conflict?.type).toBe("duplicate_alias");
    expect(dupAlias.error).toMatch(/already used/i);

    // Address book still only has the original entry
    expect(getAddressBook()).toHaveLength(1);
    expect(
      detectContactConflict({ publicKey: ADDR_ALICE, label: "Alice" }, ADDR_ALICE)
    ).toBeNull();
  });

  it("provides quick lookup by address and alias/federation address", () => {
    saveAddress({
      publicKey: ADDR_ALICE,
      label: "Alice",
      federationAddress: "alice*ophirpay.com",
    });

    expect(findContactByAddress(ADDR_ALICE)?.label).toBe("Alice");
    expect(findContactByAddress(ADDR_BOB)).toBeNull();
    expect(findContactByAlias("ALICE")?.publicKey).toBe(ADDR_ALICE);
    expect(findContactByAlias("alice*ophirpay.com")?.publicKey).toBe(ADDR_ALICE);
  });

  it("displays matching saved contacts while typing and auto-fills public key and memo on selection", () => {
    saveAddress({
      publicKey: ADDR_ALICE,
      label: "Alice Consulting",
      federationAddress: "alice*ophirpay.com",
      memo: "Consulting-42",
    });
    saveAddress({
      publicKey: ADDR_BOB,
      label: "Bob Builders",
    });

    const onSubmit = vi.fn();
    render(React.createElement(PaymentForm, { onSubmit }));

    const recipientInput = screen.getByTestId("payment-recipient-input");
    const memoInput = screen.getByTestId("payment-memo-input");

    // Type federation fragment to trigger autocomplete suggestions
    fireEvent.change(recipientInput, { target: { value: "alice*ophirpay" } });
    expect(screen.getByTestId("contact-suggestions")).toBeInTheDocument();
    expect(screen.getByText("Alice Consulting")).toBeInTheDocument();

    // Select contact -> auto-fills verified publicKey and memo, and shows recognized badge
    fireEvent.click(screen.getByTestId(`suggestion-${ADDR_ALICE}`));
    expect(recipientInput).toHaveValue(ADDR_ALICE);
    expect(memoInput).toHaveValue("Consulting-42");
    expect(screen.getByTestId("recognized-contact-badge")).toHaveTextContent(
      "Alice Consulting"
    );

    fireEvent.change(screen.getByTestId("payment-amount-input"), {
      target: { value: "125" },
    });
    fireEvent.submit(screen.getByTestId("address-book-payment-form"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: ADDR_ALICE,
        amount: "125",
        memo: "Consulting-42",
        recognizedContact: expect.objectContaining({
          publicKey: ADDR_ALICE,
          label: "Alice Consulting",
        }),
      })
    );
  });

  it("notifies the user of conflicts when adding a duplicate contact from the payment form", () => {
    saveAddress({ publicKey: ADDR_ALICE, label: "Alice" });
    render(React.createElement(PaymentForm, { initialRecipient: ADDR_BOB }));

    fireEvent.change(screen.getByTestId("new-contact-alias-input"), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByTestId("save-contact-btn"));

    expect(screen.getByTestId("add-contact-conflict-error")).toHaveTextContent(
      /already used/i
    );

    // Non-colliding alias succeeds
    fireEvent.change(screen.getByTestId("new-contact-alias-input"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByTestId("save-contact-btn"));

    expect(screen.getByTestId("add-contact-saved-notice")).toHaveTextContent(
      /Saved "Bob"/i
    );
    expect(screen.getByTestId("recognized-contact-badge")).toHaveTextContent(
      "Bob"
    );
  });

  it("warns users when an entered address matches an untrusted or blacklisted account", () => {
    saveAddress({
      publicKey: ADDR_CHARLIE,
      label: "Suspicious Vendor",
      untrusted: true,
      warningReason: "Untrusted vendor: previously disputed escrow.",
    });
    markAddressBlacklisted(ADDR_BOB, "Blacklisted phishing address.");

    expect(checkAddressTrustStatus(ADDR_CHARLIE)).toMatchObject({
      flagged: true,
      status: "untrusted",
    });
    expect(checkAddressTrustStatus(ADDR_BOB)).toMatchObject({
      flagged: true,
      status: "blacklisted",
    });

    render(
      React.createElement(PaymentForm, { initialRecipient: ADDR_CHARLIE })
    );
    expect(screen.getByTestId("untrusted-address-warning")).toHaveTextContent(
      /Untrusted vendor: previously disputed escrow/i
    );

    fireEvent.change(screen.getByTestId("payment-recipient-input"), {
      target: { value: ADDR_BOB },
    });
    expect(screen.getByTestId("untrusted-address-warning")).toHaveTextContent(
      /Blacklisted phishing address/i
    );
  });

  it("renders ContactCard with badges and supports selection and removal", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      React.createElement(ContactCard, {
        contact: {
          publicKey: ADDR_ALICE,
          label: "Alice",
          memo: "Ref-1",
          blacklisted: true,
        },
        onSelect,
        onDelete,
      })
    );

    expect(screen.getByTestId("contact-badge-blacklisted")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`contact-card-${ADDR_ALICE}`));
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Remove Alice/i }));
    expect(onDelete).toHaveBeenCalledWith(ADDR_ALICE);
  });
});
