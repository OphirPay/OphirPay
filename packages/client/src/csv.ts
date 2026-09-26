// SPDX-License-Identifier: MIT

import type { BatchRecipient } from "./types.js";

/**
 * Validates Stellar public key (56 characters starting with 'G').
 */
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(address);
}

/**
 * Parse a raw CSV row respecting double quotes and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse CSV content into an array of validated BatchRecipient objects.
 *
 * Supported header formats:
 * - `address,amount,assetCode,memo`
 * - `destination,amount,asset,memo`
 * - Headerless CSV assuming columns [address, amount, assetCode, memo]
 *
 * @param csvContent Raw text of the CSV file
 * @returns Array of validated BatchRecipient entries
 * @throws Error with line-specific diagnostic message on validation failure
 */
export function parsePaymentCsv(csvContent: string): BatchRecipient[] {
  if (!csvContent || !csvContent.trim()) {
    throw new Error("CSV content is empty");
  }

  const rawLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    throw new Error("CSV content contains no data rows");
  }

  let startIndex = 0;
  let colAddress = 0;
  let colAmount = 1;
  let colAsset = 2;
  let colMemo = 3;

  // Inspect first line for header
  const firstRow = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase());
  const hasHeader =
    firstRow.some((h) => h.includes("address") || h.includes("dest") || h.includes("recipient")) &&
    firstRow.some((h) => h.includes("amount") || h.includes("value") || h.includes("total"));

  if (hasHeader) {
    startIndex = 1;
    colAddress = firstRow.findIndex((h) => h.includes("address") || h.includes("dest") || h.includes("recipient"));
    colAmount = firstRow.findIndex((h) => h.includes("amount") || h.includes("value") || h.includes("total"));
    colAsset = firstRow.findIndex((h) => h.includes("asset") || h.includes("currency") || h.includes("token"));
    colMemo = firstRow.findIndex((h) => h.includes("memo") || h.includes("note") || h.includes("desc"));
  }

  const recipients: BatchRecipient[] = [];

  for (let i = startIndex; i < rawLines.length; i++) {
    const lineNumber = i + 1;
    const cols = parseCsvLine(rawLines[i]);

    if (cols.length === 0 || (cols.length === 1 && !cols[0])) {
      continue; // skip blank lines
    }

    const address = colAddress !== -1 ? cols[colAddress] : undefined;
    const amountStr = colAmount !== -1 ? cols[colAmount] : undefined;
    const assetCode = colAsset !== -1 && cols[colAsset] ? cols[colAsset].toUpperCase() : "XLM";
    const memo = colMemo !== -1 && cols[colMemo] ? cols[colMemo] : undefined;

    if (!address) {
      throw new Error(`CSV line ${lineNumber}: Missing destination address`);
    }

    if (!isValidStellarAddress(address)) {
      throw new Error(
        `CSV line ${lineNumber}: Invalid Stellar address "${address}". Must be 56 uppercase alphanumeric characters starting with 'G'.`
      );
    }

    if (!amountStr) {
      throw new Error(`CSV line ${lineNumber}: Missing payment amount for address ${address}`);
    }

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw new Error(
        `CSV line ${lineNumber}: Invalid payment amount "${amountStr}". Must be a positive numeric value.`
      );
    }

    if (memo && memo.length > 28) {
      throw new Error(
        `CSV line ${lineNumber}: Memo "${memo}" exceeds maximum Stellar memo limit of 28 characters.`
      );
    }

    recipients.push({
      address,
      amount,
      assetCode: assetCode || "XLM",
      memo: memo || undefined,
    });
  }

  if (recipients.length === 0) {
    throw new Error("No valid recipient rows found in CSV");
  }

  if (recipients.length > 100) {
    throw new Error(
      `CSV contains ${recipients.length} recipients. Maximum allowed per batch is 100 (split larger payouts into multiple batches).`
    );
  }

  return recipients;
}
