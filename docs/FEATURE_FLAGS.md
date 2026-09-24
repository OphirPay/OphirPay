# 🚩 Feature Flags Matrix & Override Guide

> **Purpose:** Reference documentation for OphirPay's feature flag system (`src/lib/feature-flags.ts`). Details all supported flags, environment variable mappings, default evaluation semantics, code paths gated, build-time inlining constraints, and development-only `localStorage` overrides.
>
> **Last Audited:** 2026-09-24  
> **Source Files:** [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts) · [`src/lib/storage-keys.ts`](../src/lib/storage-keys.ts) · [`src/lib/env.ts`](../src/lib/env.ts)  
> **Related Documentation:** [Deployment Guide](DEPLOYMENT.md) · [Configuration Reference](../.env.example)

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Feature Flag Matrix](#2-feature-flag-matrix)
- [3. Code Paths Gated & Current Implementation Status](#3-code-paths-gated--current-implementation-status)
- [4. Build-Time Inlining & Operational Constraints](#4-build-time-inlining--operational-constraints)
  - [4.1 Why `NEXT_PUBLIC_*` Variables Cannot Be Changed at Runtime](#41-why-next_public_-variables-cannot-be-changed-at-runtime)
  - [4.2 The Helm Chart Pitfall (`config:` block)](#42-the-helm-chart-pitfall-config-block)
  - [4.3 How to Change Flags in Production](#43-how-to-change-flags-in-production)
- [5. Development `localStorage` Overrides](#5-development-localstorage-overrides)
  - [5.1 Storage Key Convention](#51-storage-key-convention)
  - [5.2 Dev-Only Guardrails](#52-dev-only-guardrails)
  - [5.3 Usage via Console & Helper Function](#53-usage-via-console--helper-function)
- [6. Architectural Asymmetries & Common Gotchas](#6-architectural-asymmetries--common-gotchas)
- [7. How to Gate New Features (Integration Example)](#7-how-to-gate-new-features-integration-example)

---

## 1. Executive Summary

OphirPay uses a lightweight, environment-driven feature flag module defined in [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts). Flags allow enabling or disabling experimental features, managing gradual rollouts, and toggling features during local development.

Key attributes of the system:
1. **Environment-Driven:** Evaluated from `process.env.NEXT_PUBLIC_*` variables.
2. **Build-Time Inlined:** In Next.js client bundles, `NEXT_PUBLIC_*` variables are statically compiled into JavaScript bundles at build time.
3. **Local Overrides (Dev Only):** Developers can toggle flags in the browser via `localStorage` when running in `NODE_ENV === "development"`. Overrides are strictly ignored in production.

---

## 2. Feature Flag Matrix

| Flag Name (`FeatureFlag`) | Environment Variable | Evaluation Logic | Default Value | Build-Time or Runtime? | Intended Capability |
|---|---|---|---|---|---|
| `MULTI_ASSET` | `NEXT_PUBLIC_FEATURE_MULTI_ASSET` | `val !== "false"` | **`true`** (Enabled) | **Build-Time** | Multi-token payment support (USDC, custom Stellar assets, SAC contracts) |
| `RECURRING_PAYMENTS` | `NEXT_PUBLIC_FEATURE_RECURRING` | `val !== "false"` | **`true`** (Enabled) | **Build-Time** | Recurring payment schedules and subscription management |
| `WEBHOOKS` | `NEXT_PUBLIC_FEATURE_WEBHOOKS` | `val !== "false"` | **`true`** (Enabled) | **Build-Time** | Outgoing webhook event subscriptions and HMAC-signed delivery |
| `ADVANCED_ANALYTICS` | `NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS` | `val === "true"` | **`false`** (Disabled) | **Build-Time** | Deep financial metrics, transaction latency graphs, and volume histograms |
| `API_KEYS` | `NEXT_PUBLIC_FEATURE_API_KEYS` | `val !== "false"` | **`true`** (Enabled) | **Build-Time** | Programmatic API key generation, revocation, and scope controls |

---

## 3. Code Paths Gated & Current Implementation Status

> [!IMPORTANT]
> **Current Codebase Status:**
> 
> As of the current release, **no production pages (`src/app/`), API route handlers (`src/app/api/`), or UI components branch directly on `isFeatureEnabled()` or `FEATURE_FLAGS`.**
>
> All occurrences of `isFeatureEnabled` exist within test suites (`src/__tests__/lib-coverage-*.test.ts`, `branch-coverage*.test.tsx`). 
> 
> The flag infrastructure exists to support upcoming granular feature toggling and UI gating (such as hiding the API keys dashboard or multi-asset selection modal), but setting flags to `"false"` in production currently **does not disable backend routes or remove UI elements** until conditional rendering is explicitly wired into those components.

### Planned / Target Component Mapping

When UI gating is wired to `isFeatureEnabled`, the intended target boundaries are:

* **`MULTI_ASSET`:** Gates asset selector dropdowns in `/payments/new`, asset conversion preview components, and multi-currency balance cards.
* **`RECURRING_PAYMENTS`:** Gates the `/recurring` navigation link in the sidebar, subscription creation forms, and automated execution modals.
* **`WEBHOOKS`:** Gates the `/settings/webhooks` endpoint configuration dashboard, delivery history inspector, and secret rotation modals.
* **`ADVANCED_ANALYTICS`:** Gates high-resolution throughput charts, latency percentiles, and CSV export filters in `/analytics`.
* **`API_KEYS`:** Gates the `/settings/api-keys` management interface and key generation dialogues.

---

## 4. Build-Time Inlining & Operational Constraints

### 4.1 Why `NEXT_PUBLIC_*` Variables Cannot Be Changed at Runtime

Next.js adheres to the convention that any environment variable prefixed with `NEXT_PUBLIC_` is accessible to client-side browser code.

To make these variables available in the browser without exposing backend server environments, **the Next.js compiler replaces occurrences of `process.env.NEXT_PUBLIC_*` with their literal string values during the build step (`next build`)**:

```typescript
// Source code in src/lib/feature-flags.ts:
MULTI_ASSET: process.env.NEXT_PUBLIC_FEATURE_MULTI_ASSET !== "false"

// Output bundled for the browser (if built without env var):
MULTI_ASSET: undefined !== "false" // Compiles to literal true!
```

### 4.2 The Helm Chart Pitfall (`config:` block)

In containerized and Kubernetes environments, operators frequently attempt to change feature flags by updating Helm values or container environment variables:

```yaml
# helm/ophirpay/values.yaml
config:
  NEXT_PUBLIC_FEATURE_MULTI_ASSET: "false"  # ⚠️ HAS NO EFFECT ON PRE-BUILT DOCKER IMAGES!
```

> [!WARNING]
> Updating `config:` in `values.yaml` sets container environment variables on the running pod. However, because the Next.js client bundle was already built into the Docker image (`Dockerfile`), the compiled JavaScript files **already have the build-time values hardcoded**. Changing the variable on the Kubernetes pod will **not change client-side feature flag behavior**.

### 4.3 How to Change Flags in Production

To change a `NEXT_PUBLIC_` feature flag for a production deployment:

1. **Rebuild the Container Image:** Pass the desired flag as a Docker build argument or build-time environment variable:
   ```bash
   docker build \
     --build-arg NEXT_PUBLIC_FEATURE_MULTI_ASSET=false \
     -t ghcr.io/ophirpay/ophirpay:latest .
   ```
2. **Vercel Deployments:** Updating the variable in **Vercel Dashboard → Settings → Environment Variables** automatically triggers a new deployment build, ensuring the new flag value is baked into the generated static assets.

---

## 5. Development `localStorage` Overrides

To allow developers and QA engineers to test both enabled and disabled states locally without editing `.env.local` and restarting the Next.js development server, the system provides a client-side `localStorage` override mechanism.

### 5.1 Storage Key Convention

The storage key format is:

$$\text{Key} = \text{STORAGE\_KEYS.FEATURE\_FLAG\_PREFIX} + \text{flag}$$

Defined in [`src/lib/storage-keys.ts`](../src/lib/storage-keys.ts):
```typescript
export const STORAGE_KEYS = {
  FEATURE_FLAG_PREFIX: "ff_",
  // ...
};
```

For example:
* `ff_MULTI_ASSET`
* `ff_RECURRING_PAYMENTS`
* `ff_WEBHOOKS`
* `ff_ADVANCED_ANALYTICS`
* `ff_API_KEYS`

### 5.2 Dev-Only Guardrails

In [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts):

```typescript
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    const override = localStorage.getItem(`${STORAGE_KEYS.FEATURE_FLAG_PREFIX}${flag}`);
    if (override === "true") return true;
    if (override === "false") return false;
  }
  return FEATURE_FLAGS[flag] ?? false;
}
```

* **Safety:** The `process.env.NODE_ENV === "development"` condition ensures that in production builds, `localStorage` is **never queried**. End-users cannot enable unreleased or privileged features by modifying browser storage.
* **Server-Side Rendering (SSR):** On the server, `typeof window === "undefined"`, so SSR always evaluates the canonical environment variable default.

### 5.3 Usage via Console & Helper Function

#### Option A: Using Helper Functions (in App Code)
```typescript
import { overrideFeatureFlag, isFeatureEnabled } from "@/lib/feature-flags";

// Enable advanced analytics in local dev:
overrideFeatureFlag("ADVANCED_ANALYTICS", true);

// Disable webhooks in local dev:
overrideFeatureFlag("WEBHOOKS", false);
```

#### Option B: Using Browser DevTools Console
Open browser DevTools (F12) on `http://localhost:3000`:

```javascript
// Enable a flag
localStorage.setItem("ff_ADVANCED_ANALYTICS", "true");

// Disable a flag
localStorage.setItem("ff_MULTI_ASSET", "false");

// Clear override (revert to environment default)
localStorage.removeItem("ff_ADVANCED_ANALYTICS");

// View all active overrides
Object.keys(localStorage).filter(k => k.startsWith("ff_")).forEach(k => console.log(k, localStorage.getItem(k)));
```
*After changing an override in the console, refresh the page (`F5`) to re-render components with the new state.*

---

## 6. Architectural Asymmetries & Common Gotchas

Keep these four non-uniformities in mind when configuring or extending feature flags:

1. **Opt-Out vs. Opt-In Defaults:**
   * `MULTI_ASSET`, `RECURRING_PAYMENTS`, `WEBHOOKS`, and `API_KEYS` use **opt-out** semantics (`val !== "false"`). They are **enabled by default** if the environment variable is empty or undefined.
   * `ADVANCED_ANALYTICS` uses **opt-in** semantics (`val === "true"`). It is **disabled by default** unless explicitly set to `"true"`.
2. **Environment Variable Naming Discrepancy:**
   * The TypeScript flag is named `RECURRING_PAYMENTS`.
   * The environment variable is named `NEXT_PUBLIC_FEATURE_RECURRING` (omits the `_PAYMENTS` suffix).
3. **Build-Time Inlining:**
   * Setting `NEXT_PUBLIC_FEATURE_*` in container runtime environments (Docker/K8s) without a rebuild does not modify client behavior.
4. **Environment Schema Synchronization (`env.ts`):**
   * All five feature flag environment variables are declared as optional strings in `src/lib/env.ts` to prevent runtime schema validation errors.

---

## 7. How to Gate New Features (Integration Example)

When implementing new pages or components that require feature gating:

```tsx
"use client";

import React from "react";
import { isFeatureEnabled } from "@/lib/feature-flags";

export function AnalyticsDashboard() {
  const showAdvanced = isFeatureEnabled("ADVANCED_ANALYTICS");

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Analytics Overview</h1>
      <StandardMetrics />

      {showAdvanced && (
        <section className="mt-8 border-t pt-6">
          <h2 className="text-xl font-semibold">Advanced Analytics</h2>
          <LatencyHistogram />
          <TokenFlowGraph />
        </section>
      )}
    </div>
  );
}
```
