# Batch Payment CSV Format

OphirPay can import a batch of payment recipients from a comma-separated
values (CSV) file. This document is the canonical reference for that format:
the exact columns, the validation rules applied, and the error messages you
may see.

The importer lives in [`src/lib/csv-import.ts`](../src/lib/csv-import.ts)
(`parseRecipientsCsv`) and feeds the recipient validator in
[`src/lib/batch-validator.ts`](../src/lib/batch-validator.ts)
(`validateBatchRecipients`). A ready-to-edit example is available at
[`docs/samples/batch-payments.csv`](samples/batch-payments.csv).

---

## Quick reference

| | |
| --- | --- |
| Delimiter | Comma (`,`) |
| Encoding | UTF-8 (a leading BOM is stripped automatically) |
| Line endings | `LF` or Windows `CRLF` (both accepted) |
| Header row | **Required** — first row, skipped during import |
| Columns | `address,amount,assetCode,memo` |
| Max recipients per batch | 100 |
| Address format | Stellar public key, `G` followed by 55 uppercase alphanumerics |

```csv
address,amount,assetCode,memo
GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4,100,XLM,September payout
G4XAJTP2AXLVEZ5NQQSULA5L5MVCDML2RWULI2BZC6FGBBWHR3SAXHF3,25.5,XLM,
GXMZE7ZAGXTLJ2VN3RFNNQLHZN2OR23KWWXF4DYLY2EBDR6F4RHYJOCJ,0.0000001,USDC,gas fee refund
```

> **Tip:** the same file is used by the in-app template download
> (`generateRecipientsCsvTemplate` / `downloadCsvTemplate` in
> `src/lib/csv-import.ts`).

---

## Header row

The **first row is treated as a header and skipped** during import. The
header is expected to be:

```csv
address,amount,assetCode,memo
```

The header text itself is not validated — the importer skips the first line
regardless — but using the canonical header keeps files consistent and
human-readable. A file with **no header row and only data** (or an empty
file) is rejected with:

```
CSV must have a header row and at least one data row.
```

---

## Columns

| Column | Required | Description | Validation |
| --- | --- | --- | --- |
| `address` | ✅ | Stellar recipient public key | Must match `G` followed by exactly 55 uppercase letters/digits (`/^G[A-Z0-9]{55}$/`) |
| `amount` | ✅ | Payment amount for this recipient | Must parse as a number greater than `0` |
| `assetCode` | ❌ | Asset code to send (defaults to `XLM`) | Free-form string; empty cells fall back to `XLM` |
| `memo` | ❌ | Optional Stellar memo (≤ 28 bytes) | Free-form text; empty cells are omitted |

Notes:

- Columns are matched **by position**, not by name. `amount` must be the
  second cell, `assetCode` the third, and so on.
- A row with fewer than two cells (missing both `address` and `amount`) is
  rejected — see [Error scenarios](#error-scenarios).
- Extra columns beyond the fourth are ignored.
- Leading/trailing whitespace around each cell is trimmed before parsing.
- Amounts are parsed as decimal numbers (e.g. `100`, `25.5`, `0.0000001`);
  the minimum accepted is the smallest positive decimal (1 stroop =
  `0.0000001` XLM).

---

## Validation rules

Import-time rules (`parseRecipientsCsv` in `src/lib/csv-import.ts`):

1. The file must contain a header row **and** at least one data row.
2. Every data row must contain at least an `address` and an `amount`.
3. `address` must be a valid Stellar public key.
4. `amount` must be a number greater than `0`.

Rows that fail are reported with their 1-based row number (row 1 is the
header), and the rest of the file is still processed.

Validator-time rules (`validateBatchRecipients` in
`src/lib/batch-validator.ts`) — applied after a successful parse, before
the transaction is built:

5. At least one recipient is required.
6. No more than **100 recipients** per batch.
7. Addresses must be valid Stellar addresses (same check as #3).
8. Duplicate addresses are rejected — each recipient may appear only once.
9. Amounts must be greater than `0`.
10. The **sum of all amounts must not exceed the available balance** of the
    sending account.

---

## Error scenarios

### Import errors (`parseRecipientsCsv`)

| Scenario | Row reported | Message |
| --- | --- | --- |
| Empty file, or file with only a header | `0` | `CSV must have a header row and at least one data row.` |
| Row with fewer than 2 cells | row number (1-based) | `Each row must have at least address and amount.` |
| Malformed Stellar address | row number | `Invalid Stellar address at row {N}.` |
| Amount missing, non-numeric, or ≤ 0 | row number | `Invalid amount at row {N}.` |

Example — `address` with a lowercase letter and `amount` of `0`:

```csv
address,amount,assetCode,memo
g4xajtp2axlvez5nqqsula5l5mvcdml2rwuli2bzc6fgbbwhr3saxhf3,100,XLM,
GXMZE7ZAGXTLJ2VN3RFNNQLHZN2OR23KWWXF4DYLY2EBDR6F4RHYJOCJ,0,XLM,
```

produces:

```
Invalid Stellar address at row 2.
Invalid amount at row 3.
```

### Validator errors (`validateBatchRecipients`)

| Scenario | Field | Message |
| --- | --- | --- |
| No recipients at all | `recipients` | `At least one recipient is required.` |
| More than 100 recipients | `recipients` | `Maximum 100 recipients per batch.` |
| Invalid address | `address` | `Invalid Stellar address.` |
| Duplicate address | `address` | `Duplicate address.` |
| Amount ≤ 0 or non-numeric | `amount` | `Amount must be greater than 0.` |
| Total exceeds balance | `total` | `Total of {total} exceeds available balance of {balance}.` |

---

## Tips

- **Excel / Google Sheets:** export as *CSV UTF-8* — the importer strips the
  UTF-8 BOM that these tools prepend, and normalizes `CRLF` line endings.
- **Memo column:** leave it empty (trailing comma, or nothing after the
  third column) when the recipient doesn't need a memo.
- **Duplicates:** the same address may appear only once per file; split the
  amount across rows if you need multiple payments to one recipient.
- **Balance check:** the batch total is checked against the connected
  wallet's balance before signing, so a file that imports cleanly can still
  be rejected at submission time if the total is too large.
