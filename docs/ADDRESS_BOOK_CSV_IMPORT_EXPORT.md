# Address Book CSV Import & Export

## Overview
Nonprofits, DAOs, and organizations using OphirPay often maintain recurring recipient lists in spreadsheets or existing finance tooling. To eliminate manual, one-by-one address entry, OphirPay provides CSV import and export capabilities for the address book.

This feature enables users to:
1. **Bulk import contacts** from any CSV file.
2. **Export their complete address book** to standard RFC 4180 CSV for backups or sharing across devices.
3. **Round-trip fidelity**: exporting and re-importing produces an identical address book.
4. **Partial failure resilience**: rows with errors are reported with row numbers and specific reasons while all valid rows are kept and imported.
5. **Empty and header-only safety**: empty or header-only files yield clear, helpful notices instead of confusing error messages.

---

## CSV Specification

### Standard Headers
| Column | Required | Description | Example |
|---|---|---|---|
| `label` | **Yes** | Contact nickname or description (max 100 characters) | `Nonprofit Treasury` |
| `address` | **Yes** | Stellar public key (56 alphanumeric characters starting with `G`) | `GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2CTRBIAP2W2QASXYZW1` |
| `memo` | No | Optional destination memo / tag (max 28 UTF-8 bytes) | `Invoice #1024` |
| `asset` | No | Optional preferred asset code (1–12 alphanumeric characters) | `USDC` |

### Header Aliases & Order Flexibility
The parser automatically matches columns by name, allowing flexible column order and common aliases:
- **Label**: `label`, `nickname`, `name`, `contact`
- **Address**: `address`, `publickey`, `public_key`, `account`, `destination`, `recipient`
- **Memo**: `memo`, `note`, `message`, `tag`
- **Asset**: `asset`, `assetcode`, `asset_code`, `currency`, `token`

If a file has no recognizable headers, the parser falls back to positional mapping:
`Column 1: label, Column 2: address, Column 3: memo, Column 4: asset`
*(If the first column contains a valid 56-character Stellar public key and the second does not, the parser automatically recognizes Column 1 as the address and Column 2 as the label).*

---

## Validation & Error Handling

Each data row is independently validated:

1. **Address Validation**:
   - Must be non-empty.
   - Must pass `isValidStellarAddress` (56 alphanumeric characters beginning with `G`).
   - If invalid: `Row <N>: Invalid Stellar address — must be 56 characters starting with G.`

2. **Nickname/Label Validation**:
   - Must be non-empty.
   - Length must not exceed 100 characters.
   - If missing: `Row <N>: Nickname or label is required.`
   - If too long: `Row <N>: Nickname must be 100 characters or fewer.`

3. **Memo Validation**:
   - Optional.
   - If provided, UTF-8 byte length must not exceed 28 bytes (`MEMO_MAX_BYTES`).
   - If exceeding: `Row <N>: Memo must be 28 characters or fewer (28 UTF-8 bytes).`

4. **Asset Validation**:
   - Optional.
   - If provided, must match `^[a-zA-Z0-9]{1,12}$`.
   - If invalid: `Row <N>: Asset code must be 1 to 12 alphanumeric characters.`

### Partial-Failure Processing
When an uploaded file contains a mix of valid and invalid rows:
- **Valid rows** are extracted into the preview table and saved into `localStorage` upon confirmation.
- **Invalid rows** are flagged in an error summary banner, listing each row number and the exact failure reason.
- The user does not lose valid data due to a few typographical errors in other rows.

### Empty & Header-Only Handling
- **Empty file** (or whitespace-only): produces an informational message (`The CSV file is empty. Please select a file with address book records.`) with zero errors.
- **Header-only file**: produces an informational message (`The CSV file contains only headers with no address book entries.`) with zero errors.

---

## UI Components & Workflow

### 1. Export CSV
- Located in the Address Book header (`src/app/address-book/page.tsx`).
- Calls `exportAddressBookCsv(contacts)`.
- Prompts browser download of `ophirpay-address-book.csv` formatted according to RFC 4180 with standard quotes escaping.

### 2. Import CSV Modal
- Accessible via the "Import CSV" button in `src/app/address-book/page.tsx`.
- Component: `src/components/AddressBookCsvImport.tsx`.
- Features drag-and-drop file upload, file format detection, "Download sample template" action, validation error list, and preview table.
- Contacts can be reviewed before being saved via `saveAddressBatch`. Existing addresses are updated without duplication.
