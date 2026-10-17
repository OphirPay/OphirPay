# Zod-to-OpenAPI Schema Drift Verification

To prevent silent API contract drift between our Zod validation schemas (`src/lib/validation-schemas.ts`), Next.js App Router route handlers (`src/app/api/**/route.ts`), and the OpenAPI 3.1 specification (`docs/openapi.yaml`), the repository enforces an automated drift verification gate (`scripts/verify-openapi-drift.mjs`).

## Running Locally

```bash
node scripts/verify-openapi-drift.mjs
```

Or run the Vitest CI gate suite:

```bash
npx vitest run src/__tests__/openapi-zod-drift.test.ts src/__tests__/openapi-conformance.test.ts
```

## What Is Checked

1. **Route-to-Spec Parity**: Every HTTP handler (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) exported under `src/app/api/**/route.ts` must have a matching path and operation in `docs/openapi.yaml`, and vice versa.
2. **Zod-to-OpenAPI Field Parity**: Every request schema in `src/lib/validation-schemas.ts` mapped in `ZOD_OPENAPI_SCHEMA_MAP` is compared field-by-field against its corresponding `components.schemas` or inline `requestBody` schema in `docs/openapi.yaml`.

## Resolving Drift Failures

When `verify-openapi-drift.mjs` fails, it prints the exact route, Zod schema name, and drifted field name:

```text
ERROR: Detected 1 Zod-to-OpenAPI drift issue(s):
  - [POST /api/payments] (field: undocumentedFeeCap) POST /api/payments (createPaymentSchema): field "undocumentedFeeCap" exists in Zod schema but is missing from docs/openapi.yaml
```

Update the corresponding schema in `docs/openapi.yaml` (or `src/lib/validation-schemas.ts`) and re-run `node scripts/verify-openapi-drift.mjs`.
