# Refund Reason-Code Analytics & Bounded Window Specification

## Overview

The OphirPay Soroban smart contract (`contracts/ophirpay/src/lib.rs`) records structured reason codes whenever refunds are initiated (`request_refund`). The contract exposes `get_reason_code_analytics` so operators and merchants can understand dispute and return patterns.

Following the **MEDIUM-2 security remediation**, the on-chain scan is bounded to the **most recent 100 refunds** (`total.saturating_sub(99)`) to prevent unbounded gas exhaustion and ledger iteration attacks.

This implementation surfaces structured reason-code analytics across both the **Refunds Management Page** (`/refunds` -> Analytics tab) and the **Analytics Dashboard** (`/analytics`), with human-readable catalog labels, selectable date-range filtering, daily trend breakdowns, and an explicit window limitation notice.

---

## Reason Code Catalog

The reason codes strictly match the `RefundReasonCode` enum within the Soroban contract:

| Code | Variant | Display Label | Description | UI Color |
| :--- | :--- | :--- | :--- | :--- |
| `0` | `ProductDefect` | **Product Defect** | Goods or services were defective, damaged, or not as described. | `#ef4444` (Red) |
| `1` | `NonDelivery` | **Non-Delivery** | Ordered goods or services were never delivered or fulfilled. | `#f59e0b` (Amber) |
| `2` | `DuplicateCharge` | **Duplicate Charge** | Customer was billed more than once for the same order/transaction. | `#8b5cf6` (Purple) |
| `3` | `Unauthorized` | **Unauthorized Charge** | Payment was flagged as fraudulent, compromised, or unrecognized. | `#ec4899` (Pink) |
| `4` | `CustomerRequest` | **Customer Request** | Standard buyer-initiated cancellation, return, or order change. | `#10b981` (Green) |
| `5` | `Other` | **Other Reason** | Operational dispute or uncategorized refund reason. | `#6b7280` (Gray) |

---

## MEDIUM-2 Bounded Window Constraint

### On-Chain Rationale
In `contracts/ophirpay/src/lib.rs`, `get_reason_code_analytics` limits aggregation to at most 100 entries:
```rust
let start = total.saturating_sub(99);
```
Unbounded iteration over large historical datasets would exceed Soroban CPU and memory instruction limits.

### Frontend and API Disclosure
To prevent merchants and auditors from misinterpreting these metrics as lifetime totals:
1. **Prominent Informational Banner**: Both the Refunds Analytics tab and the Analytics Dashboard render a noticeable notice banner (`data-testid="refund-window-notice"`):
   > *"Metrics reflect the most recent window of up to 100 refunds (bounded by the smart contract's audit constraint) rather than all-time lifetime totals."*
2. **Metadata Payload**: API responses explicitly return `maxWindow: 100` and `windowNotice` alongside `totalRefundsInWindow`.

---

## API Specifications

### 1. `GET /api/refunds?analytics=true&detailed=true&range=30d`
Returns detailed reason code distribution, daily trend points, and window metadata.

#### Parameters:
- `analytics`: (boolean, required) Must be `"true"`.
- `detailed`: (boolean, optional) Set to `"true"` to return the rich analytics object.
- `range`: (string, optional) Preset date range: `"7d"`, `"30d"`, `"90d"`, or `"all"` (defaults to `"30d"`).

#### Response Payload (`200 OK`):
```json
{
  "success": true,
  "data": {
    "buckets": [
      {
        "code": 0,
        "label": "Product Defect",
        "description": "Goods or services were defective, damaged, or not as described.",
        "count": 12,
        "percentage": 40,
        "color": "#ef4444"
      },
      {
        "code": 1,
        "label": "Non-Delivery",
        "description": "Ordered goods or services were never delivered.",
        "count": 6,
        "percentage": 20,
        "color": "#f59e0b"
      },
      {
        "code": 2,
        "label": "Duplicate Charge",
        "description": "Customer was charged multiple times for the same transaction.",
        "count": 3,
        "percentage": 10,
        "color": "#8b5cf6"
      },
      {
        "code": 3,
        "label": "Unauthorized Charge",
        "description": "Payment was unauthorized or flagged as fraudulent.",
        "count": 1,
        "percentage": 3,
        "color": "#ec4899"
      },
      {
        "code": 4,
        "label": "Customer Request",
        "description": "Buyer requested a standard cancellation, return, or exchange.",
        "count": 7,
        "percentage": 23,
        "color": "#10b981"
      },
      {
        "code": 5,
        "label": "Other Reason",
        "description": "Operational dispute or unclassified refund reason.",
        "count": 1,
        "percentage": 3,
        "color": "#6b7280"
      }
    ],
    "trends": [
      {
        "date": "2026-03-20",
        "total": 5,
        "byReason": { "0": 2, "1": 1, "2": 0, "3": 0, "4": 2, "5": 0 }
      }
    ],
    "total": 30,
    "range": "30d",
    "maxWindow": 100,
    "windowNotice": "Metrics reflect the most recent window of up to 100 refunds (bounded by the smart contract's audit constraint) rather than all-time lifetime totals."
  }
}
```

#### Backward Compatibility:
Calling `GET /api/refunds?analytics=true` without `detailed` or `range` returns the lightweight array `[{ code: 0, count: 12 }, ...]` expected by legacy automated tests.

---

### 2. `GET /api/analytics?range=30d`
Returns comprehensive merchant analytics combining payment volume KPIs and the bounded refund reason metrics in `refundAnalytics`.

---

## User Interface Implementation

### 1. Refunds Management Page (`src/app/refunds/page.tsx`)
- **View Toggle**: Header toggle between `List` and `Analytics`.
- **Date Range Selector**: Presets for `7 Days`, `30 Days`, `90 Days`, and `All Recent`.
- **Window Limitation Banner**: Outlines the 100-refund contract constraint.
- **Reason Code Distribution Cards**:
  - Color-coded indicator dots.
  - Reason code title and contract code number `(#0..#5)`.
  - Description tooltip / subtitle.
  - Count and percentage badges.
  - Proportional animated visual progress bar.
- **Daily Trend Timeline**: Day-by-day aggregate breakdown of refund volume with per-reason badges.
- **Empty & Error Handling**: Graceful loading skeleton, clear empty states ("No refunds recorded"), and retry buttons.

### 2. Analytics Dashboard (`src/components/analytics/AnalyticsDashboard.tsx`)
- **Refund Reason Breakdown Card**: Displays alongside on-chain payment metrics.
- **Dedicated Range Selector**: Enables independent date-range filtering for refund data.
- **Quick Link**: Deep links directly to `/refunds` for full refund request and lifecycle approval operations.

---

## Verification & Testing

Unit tests in `src/__tests__/refund-reason-analytics.test.ts` verify:
1. **Catalog Integrity**: All 6 reason codes 0..5 exist with appropriate names, labels, descriptions, and colors.
2. **Label Lookup**: `getRefundReasonLabel` maps codes to readable strings with fallback for unknown codes.
3. **Bounded Window Constants**: `MAX_REFUND_ANALYTICS_WINDOW = 100` and `REFUND_WINDOW_LIMITATION_NOTICE` matches contract specifications.
4. **Data Transformation**: `toRefundReasonChartData` accurately calculates percentage shares and zero-count edge cases.
5. **Trend Aggregation**: `toRefundTrendChartData` properly buckets multi-day refund records by date and reason code.
6. **API Route Tests**:
   - `GET /api/refunds?analytics=true&detailed=true` returns structured buckets, trends, and limitation notice.
   - `GET /api/refunds?analytics=true` preserves backward-compatible raw array format.
   - `GET /api/analytics` includes `refundAnalytics` bounded to the 100-refund window.
