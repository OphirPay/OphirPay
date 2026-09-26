# 📦 JavaScript Bundle Size Budget Guide

OphirPay enforces strict **First Load JavaScript budgets** across all application routes to prevent client bundle drift, maintain fast page loads, and preserve snappy interactive performance on mobile and low-bandwidth connections.

---

## 1. Overview & Architecture

Every pull request runs bundle analysis and compares First Load JS against the committed budgets defined in [`bundle-budget.json`](../bundle-budget.json).

### What is First Load JS?
First Load JavaScript represents the total size of client-side JavaScript that a user's browser must download and execute before a specific page becomes interactive. It includes:
1. **Shared runtime chunks**: React, React-DOM, Next.js client runtime, and shared application contexts.
2. **Page-specific chunks**: Components, hooks, utilities, and page templates specific to that route.

All budgets are measured in **kilobytes (kB) gzip-compressed**, matching real-world network transfer costs.

---

## 2. Committed Route Budgets

Budgets are configured in [`bundle-budget.json`](../bundle-budget.json):

| Route | Budget (kB gzip) | Notes |
|:------|:-----------------|:------|
| `/` | 450 kB | Dashboard & overview |
| `/analytics` | 450 kB | Analytics dashboard, charting, time-series metrics |
| `/payments` | 450 kB | Payment records & search |
| `/batches` | 450 kB | Batch payments overview |
| `/batches/new` | 460 kB | Batch upload & validation wizard |
| `/webhooks` | 450 kB | Webhook endpoints & delivery logs |
| `/keys` | 450 kB | API keys management & HMAC pepper status |
| `/hooks` | 450 kB | Notification webhook subscribers |
| `/fee-config` | 450 kB | Dynamic platform fee controls |
| `/rbac` | 450 kB | Role-based access control admin page |
| `/timelock` | 450 kB | Governance timelock admin page |
| `/pause-controls` | 450 kB | Emergency circuit-breaker pause controls |
| `/refunds` | 450 kB | Refund request & processing interface |
| `/governance` | 450 kB | Multisig governance proposals |
| `/multisig` | 450 kB | Multisig signing workflows |
| `/receive` | 450 kB | QR code generator & payment receiver |
| `/send` | 600 kB | Payment submission form & Soroban simulation |
| *Default fallback* | 450 kB | Any new route without an explicit budget |

---

## 3. Running Locally

### Step 1: Generate Bundle Analysis
Run Next.js build with the `@next/bundle-analyzer` plugin enabled:
```bash
npm run analyze
```
This builds production bundles and produces interactive visualizer reports in `.next/analyze/`:
- `.next/analyze/client.html`: Visual representation of all client-side dependencies.
- `.next/analyze/nodejs.html`: Visual representation of server-side dependencies.

Open `.next/analyze/client.html` in your browser to inspect which modules and libraries occupy the most space.

### Step 2: Validate Against Budgets
Evaluate the generated build against committed budgets:
```bash
npm run bundle:check
```
Output displays a clean terminal table showing route, actual gzip size, budget, delta, and largest chunks:
```text
Route                    Actual (gzip)   Budget      Delta       Status
────────────────────────────────────────────────────────────────────────
/                        185.4 kB        300 kB      -114.6 kB   ✅ PASS
/analytics               210.2 kB        350 kB      -139.8 kB   ✅ PASS
/payments                178.6 kB        300 kB      -121.4 kB   ✅ PASS
────────────────────────────────────────────────────────────────────────
```

---

## 4. What Happens When a Budget Fails?

If a route exceeds its budget, `npm run bundle:check` exits with code `1` and details the offending route and its top chunks:

```text
❌ FAILED: 1 route(s) exceeded the committed bundle budget.
Route /analytics is 362.4 kB (budget: 350 kB, delta: +12.4 kB)
   ⚠️ Top chunks for /analytics:
      • static/chunks/heavy-chart-lib.js: 98.4 kB gzip
      • static/chunks/vendor.js: 82.1 kB gzip
```

In GitHub Actions CI:
- The check fails the build.
- A full Markdown breakdown is published directly to the PR's **Job Summary**, giving reviewers immediate visibility into which chunks and dependencies caused the increase.

---

## 5. Deliberate Budget Updates

Budgets are never updated automatically. If a new feature legitimately requires expanding a route's budget:
1. First attempt optimization:
   - Dynamic imports with `next/dynamic` for heavy components below the fold or in modal dialogs.
   - Tree-shaking verification (avoid `import * as x` when specific helpers suffice).
   - Verifying that server-only libraries (`crypto`, server SDKs) are not imported into client components.
2. If the size increase is warranted and justified:
   - Update [`bundle-budget.json`](../bundle-budget.json) with the new budget limit.
   - Document the rationale in the pull request description.
