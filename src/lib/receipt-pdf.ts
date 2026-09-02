// SPDX-License-Identifier: MIT

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { getStellarExplorerUrl } from "@/lib/stellar";

/**
 * Receipt PDF generator.
 *
 * `generateReceiptPdf` produces a printable A4 receipt containing the
 * transaction hash, amount, date, sender, recipient, memo, and a QR code
 * that links to the Stellar Explorer transaction page. It is DOM-free so it
 * can be unit-tested in Node; `downloadReceiptPdf` is the thin browser-only
 * wrapper that triggers a file download.
 */

export interface ReceiptData {
  transactionHash: string;
  /** Display amount, e.g. "100" */
  amount: string;
  /** Asset code, e.g. "XLM" */
  assetCode: string;
  /** Payment date — anything `new Date()` accepts */
  date: string;
  /** Sender public key (G...) */
  sender: string;
  /** Recipient public key (G...) */
  recipient: string;
  /** Optional Stellar memo */
  memo?: string;
}

/** Normalized, ready-to-render receipt fields (pure and testable). */
export interface ReceiptContent {
  title: string;
  transactionHash: string;
  amountLabel: string;
  dateLabel: string;
  sender: string;
  recipient: string;
  memo: string | null;
  explorerUrl: string;
  generatedAt: string;
}

const PAGE_WIDTH_MM = 210;
const MARGIN_MM = 20;

/**
 * Build the structured receipt content from raw payment data.
 * Pure function — no I/O, no DOM — kept separate from rendering so tests can
 * assert on every field without parsing the PDF.
 */
export function buildReceiptContent(receipt: ReceiptData): ReceiptContent {
  const date = new Date(receipt.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? receipt.date
    : date.toUTCString();

  return {
    title: "OphirPay Payment Receipt",
    transactionHash: receipt.transactionHash,
    amountLabel: `${receipt.amount} ${receipt.assetCode}`,
    dateLabel,
    sender: receipt.sender,
    recipient: receipt.recipient,
    memo: receipt.memo?.trim() ? receipt.memo.trim() : null,
    explorerUrl: getStellarExplorerUrl(receipt.transactionHash),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Render a receipt as a PDF Blob.
 *
 * @example
 * ```ts
 * const blob = await generateReceiptPdf({
 *   transactionHash: "abc123...",
 *   amount: "100",
 *   assetCode: "XLM",
 *   date: new Date().toISOString(),
 *   sender: "G...",
 *   recipient: "G...",
 *   memo: "September payout",
 * });
 * ```
 */
export async function generateReceiptPdf(receipt: ReceiptData): Promise<Blob> {
  const content = buildReceiptContent(receipt);
  const qrDataUrl = await QRCode.toDataURL(content.explorerUrl, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  drawReceipt(doc, content, qrDataUrl);

  return doc.output("blob");
}

/**
 * Browser-only helper: generate the receipt PDF and trigger a download.
 */
export async function downloadReceiptPdf(receipt: ReceiptData): Promise<void> {
  const blob = await generateReceiptPdf(receipt);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ophirpay-receipt-${receipt.transactionHash.slice(0, 8)}.pdf`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Layout ────────────────────────────────────────────────────

function drawReceipt(
  doc: jsPDF,
  content: ReceiptContent,
  qrDataUrl: string
): void {
  const right = PAGE_WIDTH_MM - MARGIN_MM;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("OphirPay", MARGIN_MM, 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(107, 114, 128);
  doc.text(content.title, MARGIN_MM, 33);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_MM, 39, right, 39);

  // Amount — most prominent field
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  doc.text(content.amountLabel, MARGIN_MM, 52);

  // Field rows
  let y = 68;
  const rowGap = 12;
  doc.setFontSize(10);

  fieldRow(doc, "Date", content.dateLabel, y);
  y += rowGap;
  fieldRow(doc, "Sender", content.sender, y);
  y += rowGap;
  fieldRow(doc, "Recipient", content.recipient, y);
  y += rowGap;
  fieldRow(doc, "Memo", content.memo ?? "—", y);
  y += rowGap;
  fieldRow(doc, "Transaction Hash", content.transactionHash, y);

  // QR code block — links to the Stellar Explorer tx page
  const qrSize = 34;
  const qrX = right - qrSize;
  const qrY = 138;
  doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Scan to view on Stellar Explorer", MARGIN_MM, 148);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(doc.splitTextToSize(content.explorerUrl, 120), MARGIN_MM, 154);

  // Footer
  doc.setDrawColor(226, 232, 240);
  doc.line(MARGIN_MM, 270, right, 270);
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text(
    `Generated by OphirPay — ${content.generatedAt}`,
    MARGIN_MM,
    277
  );
  doc.text(
    "This receipt is for record-keeping only and is not proof of ownership.",
    MARGIN_MM,
    282
  );
}

function fieldRow(
  doc: jsPDF,
  label: string,
  value: string,
  y: number
): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(label, MARGIN_MM, y);

  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const wrapped = doc.splitTextToSize(value, 150);
  doc.text(wrapped, 60, y);
}
