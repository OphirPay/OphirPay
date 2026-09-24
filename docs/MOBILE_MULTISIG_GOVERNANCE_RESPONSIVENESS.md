# Mobile Multisig and Governance Usability

## Overview
This document details the responsive design architecture implemented for the **Multisig Approvals** (`/multisig`) and **Governance Proposals** (`/governance`) pages in OphirPay. 

Previously, both views suffered from horizontal scrolling and unreachable or cramped action buttons on mobile screens (such as 390px iPhone 13/14 or 412px Pixel 5 viewports) due to dense tabular data, fixed widths, and inline action clusters.

## Architecture & Responsive Strategy

### 1. Viewport Adaptation (< 768px vs ≥ 768px)
- **Desktop (≥ 768px / `md:`):**
  - Renders a structured table layout with dedicated uppercase header columns (`hidden md:grid md:grid-cols-12`).
  - Rows align with column headers (`md:grid md:grid-cols-12 md:gap-4 md:items-center`).
  - Actions (Approve, Execute, Vote) align to the right with compact desktop sizing.
- **Mobile (< 768px / `< md`):**
  - Desktop table headers are hidden (`hidden md:grid`).
  - Rows adapt into distinct card containers (`flex flex-col md:grid`).
  - Crucial metadata (ID, Status badge, Recipient, Amount, Voting progress) stack cleanly.
  - Action buttons (`✓ Approve`, `Execute`, `👍 Yes`, `👎 No`) span full width or form a 2-column grid (`grid grid-cols-2 gap-2 w-full`) with touch targets conforming to WCAG 2.5.5 (minimum 44px height).

### 2. Single DOM Instance Architecture
To avoid strict-mode collisions in Playwright tests (such as `page.getByRole("button", { name: "✓ Approve" })` or `toHaveCount(0)` assertions in `e2e/multisig-flow.spec.ts`), each action button, badge, and counter is rendered **once** in the React tree and adapted purely through responsive Tailwind CSS utility classes:
- No duplicate elements hidden with `md:hidden` / `hidden md:block`.
- Seamless cross-device testing with 100% backward compatibility.

### 3. Zero Horizontal Overflow Protection
- All containers specify `max-w-full`.
- Address chips and long hashes use `truncate`, `font-mono`, and bounded widths (`max-w-[140px] sm:max-w-[200px]`).
- Progress bars use `max-w-full overflow-hidden`.
- Asserts that `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1` on 390px viewports.

## E2E Testing
The responsive behavior and mobile touch interactions are verified in:
- `e2e/multisig-governance-mobile.spec.ts`:
  - Multisig: Propose payment → assert 0 horizontal overflow on 390px → check touch target ≥ 44px → click `✓ Approve` → assert on-chain approval toast and counter update.
  - Governance: Assert 0 horizontal overflow on 390px → check vote touch targets ≥ 44px → click `👍 Yes` → assert on-chain vote toast.
  - Desktop layout: Assert table headers and column alignment on 1280px desktop viewports.
