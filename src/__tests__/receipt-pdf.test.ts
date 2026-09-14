// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  buildReceiptContent,
  generateReceiptPdf,
  type ReceiptData,
} from "@/lib/receipt-pdf";
import { getStellarExplorerUrl } from "@/lib/stellar";

const RECEIPT: ReceiptData = {
  transactionHash: "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
  amount: "100",
  assetCode: "XLM",
  date: "2026-08-27T12:00:00.000Z",
  sender: "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4",
  recipient: "G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3",
  memo: "September payout",
};

describe("buildReceiptContent", () => {
  it("produces every receipt field", () => {
    const content = buildReceiptContent(RECEIPT);

    expect(content.title).toBe("OphirPay Payment Receipt");
    expect(content.amountLabel).toBe("100 XLM");
    expect(content.transactionHash).toBe(RECEIPT.transactionHash);
    expect(content.dateLabel).toBe("Thu, 27 Aug 2026 12:00:00 GMT");
    expect(content.sender).toBe(RECEIPT.sender);
    expect(content.recipient).toBe(RECEIPT.recipient);
    expect(content.memo).toBe("September payout");
    expect(content.generatedAt).toBeTruthy();
  });

  it("links the QR code to the Stellar Explorer transaction page", () => {
    const content = buildReceiptContent(RECEIPT);
    expect(content.explorerUrl).toBe(
      getStellarExplorerUrl(RECEIPT.transactionHash)
    );
    expect(content.explorerUrl).toContain(`/tx/${RECEIPT.transactionHash}`);
  });

  it("omits an empty memo", () => {
    const content = buildReceiptContent({ ...RECEIPT, memo: "   " });
    expect(content.memo).toBeNull();
  });

  it("falls back to the raw string when the date cannot be parsed", () => {
    const content = buildReceiptContent({ ...RECEIPT, date: "not-a-date" });
    expect(content.dateLabel).toBe("not-a-date");
  });
});

describe("generateReceiptPdf", () => {
  it("returns a non-empty PDF blob", async () => {
    const blob = await generateReceiptPdf(RECEIPT);

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("embeds every receipt field in the PDF content", async () => {
    const blob = await generateReceiptPdf(RECEIPT);
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");

    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

    // Header + fields (all ASCII — readable in the uncompressed content stream)
    expect(pdf).toContain("OphirPay");
    expect(pdf).toContain("Payment Receipt");
    expect(pdf).toContain("100");
    expect(pdf).toContain("XLM");
    expect(pdf).toContain(RECEIPT.transactionHash);
    expect(pdf).toContain(RECEIPT.sender);
    expect(pdf).toContain(RECEIPT.recipient);
    expect(pdf).toContain("September payout");
    expect(pdf).toContain("Scan to view on Stellar Explorer");
  });

  it("includes the full explorer link (across wrapped text lines)", async () => {
    const blob = await generateReceiptPdf(RECEIPT);
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    const explorerUrl = getStellarExplorerUrl(RECEIPT.transactionHash);

    // jspdf can wrap the URL across Tj lines — join every text operand in
    // document order so the full link is asserted, not a single line.
    const allText = [...pdf.matchAll(/\(([^()]*)\) Tj/g)]
      .map((m) => m[1])
      .join("");
    expect(allText).toContain(explorerUrl);
  });

  it("embeds the QR code image object", async () => {
    const blob = await generateReceiptPdf(RECEIPT);
    const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");

    // jspdf embeds the QR PNG as an image XObject.
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/Width ");
    expect(pdf).toContain("/Height ");
  });

  it("works without a memo", async () => {
    const { memo: _memo, ...noMemo } = RECEIPT;
    const blob = await generateReceiptPdf(noMemo);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
