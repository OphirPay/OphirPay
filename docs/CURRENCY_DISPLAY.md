# Currency Display & Rounding Rules Specification

## Overview

OphirPay provides a currency display toggle (`XLM` ↔ `USD`) on the payments table, allowing users to view payments in either native Stellar Lumens (XLM) or equivalent US Dollars (USD).

---

## 1. Currency Display Modes

| Mode | Format | Description |
|---|---|---|
| **XLM** | `<amount> XLM` (e.g., `10.50 XLM`) | Canonical on-chain amount derived directly from stroops (`stroops / 10^7`). |
| **USD** | `$ <amount>` (e.g., `$1.26`) | Converted fiat value calculated from validated external price feed (`amountXlm * rate`). |

---

## 2. Rounding & Formatting Rules

### XLM Formatting Rules
- **Precision**: Preserves up to 7 decimal places (Stellar Stroop precision: `1 XLM = 10,000,000 stroops`).
- **Separators**: Uses standard localized thousands separators (`1,234,567.89`).
- **Minimum decimals**: 2 decimal places for standard display.
- **Safety**: Non-numeric, negative, or invalid values safely format as `"—"`.

### USD Formatting Rules
- **Precision**: Fixed 2 fractional digits (`$1,234.56`), rounded half-up using standard currency formatting rules.
- **Source**: Derived strictly from validated positive numeric rates (`rate > 0`).
- **Safety & Fallback**:
  - If external price feed is unavailable, loading, invalid, or non-positive, the display renders `"Unavailable"`.
  - Never renders `NaN`, `Infinity`, or broken layouts.

---

## 3. Storage & Persistence

- **Storage Key**: `payments.currencyDisplay` (`localStorage`)
- **Default Value**: `"XLM"`
- **Lifecycle**:
  - Saved to `localStorage` on user selection.
  - Automatically restored on next page load or session.
  - SSR-safe fallback to default `"XLM"` prior to client hydration.

---

## 4. API & Component Architecture

- `src/lib/price.ts`: Pure conversion, validation, rounding, and API fetch functions.
- `src/hooks/usePrice.ts`: React Query hook managing cached price feeds with automatic fallback.
- `src/components/ui/CurrencyToggle.tsx`: Accessible ARIA-compliant toggle component.
- `src/app/api/price/route.ts`: API route proxying price feeds with memory caching.
