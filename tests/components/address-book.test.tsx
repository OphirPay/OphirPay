// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  validateContactUniqueness,
  searchAddressBook,
  lookupContactByAddress,
  lookupContactByAlias,
  isBlacklistedAddress,
  isUntrustedAddress,
  saveAddress,
  saveAddressSafe,
  KNOWN_BLACKLISTED_ADDRESSES,
  type AddressEntry,
} from "@/lib/address-book";
import { ContactCard } from "@/components/address-book/contact-card";
import { PaymentForm } from "@/components/forms/payment-form";

const TEST_ADDR_ALICE = "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ1";
const TEST_ADDR_BOB = "GBBDNXFVR2VGBYV6F27W6DX2OQGPY36N3YF7J3BGB3GZ7F7QWY6XYZ2B";
const TEST_ADDR_CHARLIE = "GCABCDEF234567GHIJKLMN89OPQRSTUVWX345678YZABCDEF00000003";

beforeEach(() => {
  localStorage.clear();
});

describe("Address Book - Search, Uniqueness & Lookup Utilities", () => {
  const initialContacts: AddressEntry[] = [
    {
      publicKey: TEST_ADDR_ALICE,
      label: "Alice Treasury",
      alias: "alice_treasury",
      federationAddress: "alice*ophirpay.com",
      memo: "INVOICE-001",
    },
    {
      publicKey: TEST_ADDR_BOB,
      label: "Bob Operations",
      alias: "bob_ops",
      memo: "PAYROLL",
      isUntrusted: true,
    },
    {
      publicKey: TEST_ADDR_CHARLIE,
      label: "Flagged Account",
      alias: "scam_charlie",
      isBlacklisted: true,
    },
  ];

  it("validates contact uniqueness and detects duplicate public key conflicts", () => {
    const res = validateContactUniqueness(
      { publicKey: TEST_ADDR_ALICE, alias: "brand_new_alias" },
      initialContacts
    );
    expect(res.valid).toBe(false);
    expect(res.conflictType).toBe("duplicate_public_key");
    expect(res.message).toContain(TEST_ADDR_ALICE);
  });

  it("validates contact uniqueness and detects duplicate alias conflicts", () => {
    const res = validateContactUniqueness(
      { publicKey: "GNEWPUBLICKEY00000000000000000000000000000000000000000004", alias: "ALICE_TREASURY" },
      initialContacts
    );
    expect(res.valid).toBe(false);
    expect(res.conflictType).toBe("duplicate_alias");
    expect(res.message).toContain("ALICE_TREASURY");
  });

  it("allows updating an existing contact without flagging self as duplicate", () => {
    const res = validateContactUniqueness(
      { publicKey: TEST_ADDR_ALICE, alias: "alice_treasury" },
      initialContacts,
      TEST_ADDR_ALICE
    );
    expect(res.valid).toBe(true);
  });

  it("searches contacts by name/label, alias, federation address, or public key prefix", () => {
    // Search by label
    const byLabel = searchAddressBook("Treasury", initialContacts);
    expect(byLabel).toHaveLength(1);
    expect(byLabel[0].publicKey).toBe(TEST_ADDR_ALICE);

    // Search by alias
    const byAlias = searchAddressBook("bob_ops", initialContacts);
    expect(byAlias).toHaveLength(1);
    expect(byAlias[0].publicKey).toBe(TEST_ADDR_BOB);

    // Search by federation address
    const byFed = searchAddressBook("ophirpay.com", initialContacts);
    expect(byFed).toHaveLength(1);
    expect(byFed[0].publicKey).toBe(TEST_ADDR_ALICE);

    // Search by public key prefix
    const byPrefix = searchAddressBook("GCABCDEF", initialContacts);
    expect(byPrefix).toHaveLength(1);
    expect(byPrefix[0].publicKey).toBe(TEST_ADDR_CHARLIE);

    // Empty search returns all
    expect(searchAddressBook("", initialContacts)).toHaveLength(3);
  });

  it("looks up contact by address or alias accurately", () => {
    expect(lookupContactByAddress(TEST_ADDR_ALICE, initialContacts)?.alias).toBe("alice_treasury");
    expect(lookupContactByAddress("  " + TEST_ADDR_ALICE + "  ", initialContacts)?.alias).toBe("alice_treasury");
    expect(lookupContactByAddress("GUNKNOWN", initialContacts)).toBeUndefined();

    expect(lookupContactByAlias("bob_ops", initialContacts)?.publicKey).toBe(TEST_ADDR_BOB);
    expect(lookupContactByAlias("Alice Treasury", initialContacts)?.publicKey).toBe(TEST_ADDR_ALICE);
  });

  it("identifies blacklisted and untrusted addresses", () => {
    expect(isBlacklistedAddress(TEST_ADDR_CHARLIE, initialContacts)).toBe(true);
    expect(isUntrustedAddress(TEST_ADDR_CHARLIE, initialContacts)).toBe(true);

    expect(isUntrustedAddress(TEST_ADDR_BOB, initialContacts)).toBe(true);
    expect(isBlacklistedAddress(TEST_ADDR_BOB, initialContacts)).toBe(false);

    expect(isBlacklistedAddress(TEST_ADDR_ALICE, initialContacts)).toBe(false);
    expect(isUntrustedAddress(TEST_ADDR_ALICE, initialContacts)).toBe(false);

    // Known global blacklist check
    const knownBlacklist = Array.from(KNOWN_BLACKLISTED_ADDRESSES)[0];
    expect(isBlacklistedAddress(knownBlacklist)).toBe(true);
  });

  it("saves address with safe conflict checks", () => {
    initialContacts.forEach((c) => saveAddress(c));

    // Colliding alias
    const failRes = saveAddressSafe({
      publicKey: "GNEWACCOUNT0000000000000000000000000000000000000000000005",
      label: "New",
      alias: "alice_treasury",
    });
    expect(failRes.success).toBe(false);
    expect(failRes.conflictType).toBe("duplicate_alias");

    // Success save
    const okRes = saveAddressSafe({
      publicKey: "GNEWACCOUNT0000000000000000000000000000000000000000000005",
      label: "New Account",
      alias: "brand_new_5",
    });
    expect(okRes.success).toBe(true);
  });
});

describe("ContactCard Component", () => {
  const contact: AddressEntry = {
    publicKey: TEST_ADDR_ALICE,
    label: "Alice Corp",
    alias: "alice_corp",
    federationAddress: "alice*corp.org",
    memo: "INV-999",
  };

  it("renders contact card details, alias badge, and verified badge", () => {
    render(<ContactCard contact={contact} />);
    expect(screen.getByTestId("contact-label")).toHaveTextContent("Alice Corp");
    expect(screen.getByTestId("contact-alias-badge")).toHaveTextContent("@alice_corp");
    expect(screen.getByTestId("contact-federation-address")).toHaveTextContent("alice*corp.org");
    expect(screen.getByTestId("contact-memo")).toHaveTextContent("INV-999");
    expect(screen.getByTestId("contact-verified-badge")).toHaveTextContent("Verified");
  });

  it("renders blacklisted and untrusted badges appropriately", () => {
    const { rerender } = render(
      <ContactCard contact={{ ...contact, isBlacklisted: true }} />
    );
    expect(screen.getByTestId("contact-blacklisted-badge")).toBeInTheDocument();

    rerender(<ContactCard contact={{ ...contact, isUntrusted: true }} />);
    expect(screen.getByTestId("contact-untrusted-badge")).toBeInTheDocument();
  });

  it("triggers onSelect, onEdit, and onDelete action callbacks", () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <ContactCard
        contact={contact}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTestId("contact-select-btn"));
    expect(onSelect).toHaveBeenCalledWith(contact);

    fireEvent.click(screen.getByTestId("contact-edit-btn"));
    expect(onEdit).toHaveBeenCalledWith(contact);

    fireEvent.click(screen.getByTestId("contact-delete-btn"));
    expect(onDelete).toHaveBeenCalledWith(contact.publicKey);
  });
});

describe("PaymentForm Component - Address Book Integration", () => {
  beforeEach(() => {
    localStorage.clear();
    saveAddress({
      publicKey: TEST_ADDR_ALICE,
      label: "Alice Treasury",
      alias: "alice_treasury",
      memo: "AUTO-FILLED-MEMO-42",
    });
    saveAddress({
      publicKey: TEST_ADDR_CHARLIE,
      label: "Scammer Charlie",
      alias: "bad_actor",
      isBlacklisted: true,
    });
  });

  it("displays matching saved contacts in suggestions dropdown while typing", async () => {
    render(<PaymentForm />);
    const input = screen.getByTestId("recipient-input");

    await userEvent.type(input, "alice");
    expect(screen.getByTestId("contacts-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Alice Treasury")).toBeInTheDocument();
    expect(screen.getByText("@alice_treasury")).toBeInTheDocument();
  });

  it("selecting a contact auto-fills the verified public key, memo, and recognized badge", async () => {
    render(<PaymentForm />);
    const input = screen.getByTestId("recipient-input");

    await userEvent.type(input, "alice");
    const suggestion = screen.getByTestId(`contact-suggestion-${TEST_ADDR_ALICE}`);
    fireEvent.mouseDown(suggestion);

    // Public key filled
    expect(input).toHaveValue(TEST_ADDR_ALICE);

    // Memo auto-filled
    const memoInput = screen.getByTestId("memo-input");
    expect(memoInput).toHaveValue("AUTO-FILLED-MEMO-42");

    // Recognized contact badge displayed
    expect(screen.getByTestId("contact-recognized-badge")).toHaveTextContent("@alice_treasury");
  });

  it("displays a security warning banner when entering a blacklisted address", async () => {
    render(<PaymentForm />);
    const input = screen.getByTestId("recipient-input");

    await userEvent.type(input, TEST_ADDR_CHARLIE);

    const banner = screen.getByTestId("address-warning-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Security Alert: Blacklisted Address");
  });

  it("allows saving a new contact and warns user on alias conflict", async () => {
    const validNewAddr = "GA5ZSEJ4KZ3P4P6XWJLZ4TLQUDV6C6PDU4XJ7BCVQZ4TVPULZNK3WYJ8";
    render(<PaymentForm initialRecipient={validNewAddr} />);

    // Click save action
    const saveBtn = screen.getByTestId("save-contact-action-btn");
    fireEvent.click(saveBtn);

    expect(screen.getByTestId("save-contact-modal")).toBeInTheDocument();

    // Attempt to use already taken alias
    const aliasInput = screen.getByTestId("save-alias-input");
    await userEvent.type(aliasInput, "alice_treasury");

    fireEvent.click(screen.getByTestId("confirm-save-contact-btn"));

    // Error displayed
    const err = screen.getByTestId("contact-conflict-error");
    expect(err).toBeInTheDocument();
    expect(err).toHaveTextContent("already exists");
  });

  it("submits payment form data with selected contact information", async () => {
    const onSubmit = vi.fn();
    render(<PaymentForm initialRecipient={TEST_ADDR_ALICE} initialAmount="150.50" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("payment-submit-btn"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: TEST_ADDR_ALICE,
          amount: "150.50",
          asset: "USDC",
          contact: expect.objectContaining({
            alias: "alice_treasury",
          }),
        })
      );
    });
  });
});
