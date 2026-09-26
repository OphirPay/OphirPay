# Feature Flags

OphirPay uses a small set of compile-time feature flags to gate UI surfaces and
API routes. Every flag is read from an environment variable prefixed with
`NEXT_PUBLIC_FEATURE_` and evaluated once at build time. A thin
`localStorage`-based override layer lets developers flip flags without
rebuilding during local development.

Source of truth: [`src/lib/feature-flags.ts`](../src/lib/feature-flags.ts)

---

## Flag reference

| Flag | Env variable | Default (no var set) | What it gates | Default type |
|---|---|---|---|---|
| `MULTI_ASSET` | `NEXT_PUBLIC_FEATURE_MULTI_ASSET` | **enabled** | Multi-asset send/receive UI, asset-selector component, multi-asset contract calls | opt-out |
| `RECURRING_PAYMENTS` | `NEXT_PUBLIC_FEATURE_RECURRING` | **enabled** | Recurring / scheduled payment creation UI and the `/api/scheduled/*` routes | opt-out |
| `WEBHOOKS` | `NEXT_PUBLIC_FEATURE_WEBHOOKS` | **enabled** | Webhook management UI and the `/api/webhooks/*` delivery routes | opt-out |
| `ADVANCED_ANALYTICS` | `NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS` | **disabled** | Extended analytics dashboard, exportable reports, advanced chart views | opt-in |
| `API_KEYS` | `NEXT_PUBLIC_FEATURE_API_KEYS` | **enabled** | API key management UI and the `/api/keys/*` CRUD routes | opt-out |

### Default behaviour

Most flags are **opt-out**: the feature is active unless you explicitly set the
variable to `"false"`.

```
NEXT_PUBLIC_FEATURE_MULTI_ASSET=false     # disables the feature
# (variable absent or any other value)   # feature is enabled
```

`ADVANCED_ANALYTICS` is the exception — it is **opt-in**: the feature is
inactive unless you explicitly set the variable to `"true"`.

```
NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS=true   # enables the feature
# (variable absent or any other value)        # feature is disabled
```

This asymmetry is intentional: advanced analytics involves additional data
retention and should only be turned on deliberately in environments that are
ready for it.

---

## Build-time inlining (important for production)

All `NEXT_PUBLIC_*` variables are **inlined at Next.js build time**. The
compiled JavaScript bundle contains the resolved boolean value, not a reference
to the environment variable.

**Consequence:** changing a feature-flag variable in Kubernetes / Helm / Vercel
environment settings has **no effect** on a running deployment. You must
**rebuild and redeploy** the application for the new value to take effect.

### Helm / CI note

When using the Helm chart, pass feature flags as build args rather than runtime
`env:` entries:

```yaml
# values.yaml (example)
buildArgs:
  NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS: "true"
  NEXT_PUBLIC_FEATURE_MULTI_ASSET: "false"
```

If you pass them only as pod environment variables they will be silently ignored
by the already-built bundle.

---

## localStorage override (development only)

During local development (`NODE_ENV=development`) you can override any flag in
the browser without rebuilding. The override is stored in `localStorage` and
checked by `isFeatureEnabled()` before falling back to the build-time value.

### Key format

```
ff_<FLAG_NAME>
```

Examples: `ff_MULTI_ASSET`, `ff_ADVANCED_ANALYTICS`, `ff_API_KEYS`.

### How to set an override

Open the browser's DevTools console on any OphirPay page and run:

```js
// Enable a flag
localStorage.setItem('ff_ADVANCED_ANALYTICS', 'true');

// Disable a flag
localStorage.setItem('ff_MULTI_ASSET', 'false');

// Remove override (reverts to build-time value)
localStorage.removeItem('ff_MULTI_ASSET');
```

Then **reload the page** — `isFeatureEnabled()` is called during render, not
reactively.

You can also use the typed helper exported from `src/lib/feature-flags.ts`:

```ts
import { overrideFeatureFlag } from '@/lib/feature-flags';

overrideFeatureFlag('ADVANCED_ANALYTICS', true);
```

### Restriction

The localStorage path is guarded by two conditions:

```ts
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
```

- **`typeof window !== 'undefined'`** — server-side rendering and API routes
  always use the build-time value.
- **`process.env.NODE_ENV === 'development'`** — because `NODE_ENV` is also
  inlined at build time, production and preview builds have this branch
  compiled away entirely. localStorage overrides are impossible in those
  environments regardless of what is stored in the browser.

---

## Checking a flag in application code

```ts
import { isFeatureEnabled } from '@/lib/feature-flags';

if (isFeatureEnabled('ADVANCED_ANALYTICS')) {
  // render analytics dashboard
}
```

Always use `isFeatureEnabled()` rather than reading `FEATURE_FLAGS` directly —
the function applies the localStorage override in development and keeps the call
site agnostic of the override mechanism.

---

## Adding a new flag

1. Add an entry to `FEATURE_FLAGS` in `src/lib/feature-flags.ts`.  
   - Opt-out: `MY_FLAG: process.env.NEXT_PUBLIC_FEATURE_MY_FLAG !== 'false'`  
   - Opt-in:  `MY_FLAG: process.env.NEXT_PUBLIC_FEATURE_MY_FLAG === 'true'`
2. Add the variable to `.env.example` under the `# ── Feature Flags` section
   with a comment explaining what it controls.
3. Add a row to the [Flag reference](#flag-reference) table above.
4. Gate your feature with `isFeatureEnabled('MY_FLAG')`.
5. Update Helm `values.yaml` / CI pipeline if a non-default value is needed in
   any environment.
