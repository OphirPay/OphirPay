# OphirPay API Endpoint Guide

This guide is the single reference for **adding new API endpoints** to
OphirPay. It documents the conventions every route must follow so that new
endpoints are consistent, secure, and maintainable.

> **Before you start:** read the [Contributing guide](../CONTRIBUTING.md) and
> the [Integration Guide](./integration-guide.md). Keep this page open while
> you implement — the [checklist](#checklist) at the end is the gate for
> merging.

---

## Table of Contents

1. [How API routes are organized](#1-how-api-routes-are-organized)
2. [Route handler skeleton](#2-route-handler-skeleton)
3. [Zod validation](#3-zod-validation)
4. [Error-handling pattern](#4-error-handling-pattern)
5. [Auth middleware usage](#5-auth-middleware-usage)
6. [Response envelope](#6-response-envelope)
7. [Rate-limit integration](#7-rate-limit-integration)
8. [Worked example](#8-worked-example)
9. [Testing your endpoint](#9-testing-your-endpoint)
10. [Checklist](#checklist)

---

## 1. How API routes are organized

Every HTTP endpoint lives in `src/app/api/`, one directory per resource:

```
src/app/api/
├── payments/
│   ├── route.ts          # GET /api/payments, POST /api/payments
│   └── [id]/
│       └── route.ts      # GET /api/payments/:id, PATCH /api/payments/:id, DELETE /api/payments/:id
├── webhooks/
│   ├── route.ts
│   └── [id]/route.ts
└── <your-resource>/
    ├── route.ts          # collection: GET (list), POST (create)
    └── [id]/route.ts     # item: GET, PATCH, DELETE (only if needed)
```

Conventions:

- **File name must be exactly `route.ts`** — Next.js App Router maps the
  directory path to the URL. A sub-directory `[id]` creates a dynamic segment.
- **Export HTTP verbs as named exports**: `export async function GET(req)`,
  `POST`, `PATCH`, `DELETE`. Next.js calls the matching export.
- **One resource per directory.** Shared logic (validation schemas, helpers)
  lives in `src/lib/`, never duplicated across routes.
- **Never put business logic in the route file.** The handler should parse →
  validate → authorize → delegate to `src/lib/` helpers → respond.
- Every file starts with the SPDX header `// SPDX-License-Identifier: MIT`.

The public contract of every endpoint is documented in
[`docs/openapi.yaml`](./openapi.yaml) — update it whenever you add or change a
route (see the [checklist](#checklist)).

---

## 2. Standardized Route Pipeline Wrappers (`src/lib/api-wrapper.ts`)

Instead of writing manual, repetitive preambles across endpoints, OphirPay standardizes all API route handlers on composable pipeline wrappers defined in [`src/lib/api-wrapper.ts`](../src/lib/api-wrapper.ts):

- **`withMutatingRoute`**: For state-mutating requests (`POST`, `PATCH`, `DELETE`, `PUT`).
- **`withQueryRoute`**: For read-only requests (`GET`, `HEAD`).
- **`withAuth` & `withValidation`**: Composable primitives for custom route workflows.

### Pipeline Guarantees

Every wrapped endpoint automatically executes in this strict, security-hardened sequence:

1. **Metrics Measurement:** Automatically wrapped in `withMetrics("METHOD /path")` for Prometheus latency and status metrics.
2. **Request-ID Logging:** `withRequestLogging` generates or propagates `X-Request-Id` and logs execution duration.
3. **Centralized Error Translation:** Entire execution wrapped in `try/catch` with `handleApiError`, returning sanitized JSON responses.
4. **CSRF Protection:** Mutating routes automatically execute `verifyCsrf(request)` before handling any request data. Cannot be omitted without an explicit, reviewable `optOutCsrf` reason.
5. **Authentication Verification:** Handlers resolve `getAuthContext(request)` and assert wallet session / API key validity. Cannot be omitted without an explicit, reviewable `optOutAuth` reason.
6. **Zod Schema Validation:** Automatically parses `bodySchema` and/or `querySchema`, returning HTTP 400 `validationError` on mismatch and passing typed data into the handler.
7. **Async Next.js 15 Route Params:** Resolves dynamic `params` (e.g. `[id]`) whether sync or async.

### Mutating Route Skeleton (`POST` / `PATCH` / `DELETE` / `PUT`)

```ts
// src/app/api/<resource>/route.ts
// SPDX-License-Identifier: MIT

import { z } from "zod";
import prisma from "@/lib/prisma";
import { successResponse, notFoundError } from "@/lib/api-response";
import { withMutatingRoute } from "@/lib/api-wrapper";

const createResourceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.number().positive("Amount must be positive"),
});

export const POST = withMutatingRoute(
  {
    route: "POST /api/<resource>",
    bodySchema: createResourceSchema,
  },
  async ({ body, auth }) => {
    // 1. Auth is guaranteed valid; always scope to auth.userId
    const item = await prisma.resource.create({
      data: {
        name: body.name,
        amount: body.amount,
        userId: auth.userId,
      },
    });

    // 2. Respond with standard envelope
    return successResponse(item, undefined, 201);
  }
);
```

### Read Route Skeleton (`GET`)

```ts
import { paginationSchema } from "@/lib/validation-schemas";
import { successResponse } from "@/lib/api-response";
import { withQueryRoute } from "@/lib/api-wrapper";

export const GET = withQueryRoute(
  {
    route: "GET /api/<resource>",
    querySchema: paginationSchema,
  },
  async ({ query, auth }) => {
    const items = await prisma.resource.findMany({
      where: { userId: auth.userId },
      take: query.limit,
    });
    return successResponse(items);
  }
);
```

### Explicit Security Opt-Outs

Any route that legitimately differs from the standard authenticated session pipeline must declare an explicit, reviewable reason. Empty or missing reasons are rejected at compile-time and runtime:

```ts
// Webhook receiver (no user session cookie, no CSRF from external senders)
export const POST = withMutatingRoute(
  {
    route: "POST /api/webhooks/incoming",
    bodySchema: webhookPayloadSchema,
    optOutCsrf: "External webhook sender verified via cryptographic HMAC signature in headers",
    optOutAuth: "Signature verification in handler replaces user session authentication",
  },
  async ({ body, request }) => {
    // Signature verified inside handler
  }
);
```

---

## 3. Zod validation

All input validation uses [Zod](https://zod.dev) (already a dependency — do not
add another validation library).

### Where schemas live

- Reusable request/query schemas go in **`src/lib/validation-schemas.ts`**.
- Small, one-off schemas may be defined inline in the route file, but prefer
  the shared module so schemas are unit-testable and reusable.

### Validating a request body

```ts
const body = await request.json();
const parsed = myCreateSchema.safeParse(body);
if (!parsed.success) return validationError(parsed.error);
// parsed.data is fully typed
```

Never use `parse()` (throws) or trust unvalidated JSON. `safeParse` + an early
`return validationError(...)` keeps errors uniform.

### Validating query parameters

Query params arrive as strings. Coerce them in the schema with
`z.coerce` so numbers/booleans validate correctly:

```ts
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
});

const parsed = paginationSchema.safeParse({
  page: searchParams.get("page"),
  limit: searchParams.get("limit"),
  status: searchParams.get("status"),
  search: searchParams.get("search"),
});
if (!parsed.success) return validationError(parsed.error);
```

> `validationError(err)` returns `400` with
> `{ success: false, error: { code: "VALIDATION_ERROR", message, details } }`
> where `details` is an array of `{ path, message }` per issue — clients can
> render field-level errors directly.

---

## 4. Error-handling pattern

All error responses are produced by helpers in **`src/lib/api-response.ts`**.
Never hand-roll an error body.

| Helper | HTTP | When to use |
|---|---|---|
| `validationError(zodError)` | 400 | Zod `safeParse` failed |
| `badRequestError(message)` | 400 | Malformed/unsupported request (not schema-shaped) |
| `unauthorizedError(message?)` | 401 | No/invalid session or API key |
| `notFoundError(resource?)` | 404 | Resource does not exist |
| `conflictError(message)` | 409 | State conflict (e.g. duplicate, invalid transition) |
| `rateLimitError(message?)` | 429 | Route-level limit exceeded |
| `serverError(message?)` | 500 | Unexpected failure (message masked in prod) |
| `handleApiError(err, context)` | varies | **Always** in `catch` |

`handleApiError` is the single entry point for unexpected errors:

- **Zod errors** → 400 with a joined message
- **Prisma errors** → correct status via `src/lib/prisma-errors.ts`
  (404 for missing records, 409 for unique conflicts, 503 for unavailable DB, …)
- **Anything else** → 500, with the real message **masked in production**
  (`"An unexpected error occurred."`) while staying detailed in development

Error codes are centralized in **`src/lib/error-codes.ts`** (`ERROR_CODES`) —
reuse them instead of inventing new strings.

---

## 5. Auth middleware usage

OphirPay has two authentication modes, both resolved by one function:

### `getAuthContext(request)` — the default (recommended)

From `@/lib/auth-session`. Resolves either:

1. A **wallet session cookie** (browser UI) → `{ userId, publicKey }`
2. An **API key** (`Authorization: Bearer <key>` or `X-API-Key: <key>` header,
   machine-to-machine) → `{ userId, keyId }`

```ts
const auth = await getAuthContext(request);
if (!auth) {
  return unauthorizedError(
    "Authentication required. Connect your wallet or provide an API key."
  );
}
// auth.userId — always scope queries to this!
```

**Every route that reads or writes user data must use `getAuthContext` and
scope all queries to `auth.userId`.** Never expose another user's records.

### API-key-only routes

If a route is meant strictly for machine-to-machine callers, use
`src/lib/api-auth.ts`:

```ts
import { requireAuth, withApiAuth } from "@/lib/api-auth";

// Option A — wrapper (when the handler doesn't need the key identity)
export const GET = withApiAuth(async (request) => { ... });

// Option B — inside the handler (when you need userId/keyId)
const auth = await requireAuth(request);
if (!("userId" in auth)) return auth; // auth is an error Response
```

---

## 6. Response envelope

Every response — success or error — uses a consistent envelope.

### Success

```ts
successResponse(data, meta?, status = 200, cacheHeader?)
// → 200 { "success": true, "data": <payload>, "meta": { "timestamp": "...", ...meta } }
```

- `data` is the payload (object or array).
- `meta` is optional and reserved for pagination metadata
  (`{ page, limit, total, nextCursor, hasMore, ... }`) and the auto-added
  `timestamp`.
- Pass a `cacheHeader` (e.g. `"public, max-age=300"`) only for genuinely
  cacheable, authenticated-safe responses.
- Values are passed through `jsonSafe`, which serializes `BigInt` and `Date`
  safely — never `JSON.stringify` Prisma rows yourself.

```ts
return successResponse(payments, { page, limit, total });   // 200 list
return successResponse(payment, undefined, 201);            // 201 created
```

### Error

```ts
// produced by the helpers in §4
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] }, "timestamp": "..." }
```

Clients check `success` first; `code` is stable for programmatic handling.

---

## 7. Rate-limit integration

Rate limiting is enforced **globally at the proxy layer** in
[`src/proxy.ts`](../src/proxy.ts) for every `/api/*` path — you do **not** need
to add per-route limiting for the common case.

How it works:

- **Per-IP sliding window**: `X` requests per minute per client IP
  (`RATE_LIMIT_RPM` env var, default `120`).
- **Exempt paths**: `/api/health` and `/api/metrics` are never throttled
  (monitoring endpoints are hit frequently by orchestrators). `/api/metrics`
  is still **authenticated** — it requires `Authorization: Bearer
  $METRICS_TOKEN` (see [Per-Endpoint Metrics](./metrics-endpoints.md)).
- **Headers** on every API response:
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **On exceed**: `429` with `Retry-After` and body
  `{ success: false, error: { code: "RATE_LIMITED", ... } }`.
- **Backends**: in-memory by default (per-instance). `REDIS_URL` selects a
  distributed store, and its **scheme** selects the transport (see
  `src/lib/rate-limit.ts`):
  - `redis://` / `rediss://` → `ioredis`, **Node runtime only**. The global
    limit in `src/proxy.ts` runs on the Edge runtime and cannot use it, so it
    stays per-instance; the route-level buckets (auth, lookup) do share state.
  - `https://` (Upstash-compatible REST) → shared by **every** replica on both
    runtimes, including the global edge limit. Set `REDIS_TOKEN` for hosted
    providers.

  With `REDIS_URL` unset, every limit is per-instance in memory.

### When to add route-level limits

Only add an explicit check inside a handler when a specific route needs a
**stricter** limit than the global one (e.g. an expensive or abuse-prone
operation), or when it must be keyed by the authenticated user rather than IP:

```ts
import { getRateLimitStore } from "@/lib/rate-limit";
import { rateLimitError } from "@/lib/api-response";

const result = await getRateLimitStore().increment(
  `user:${auth.userId}:<operation>`,
  60_000,     // window
  10          // max per window
);
if (!result.allowed) return rateLimitError();
```

If you add such a limit, document it in the endpoint's OpenAPI description and
mention it in the PR.

---

## 8. Worked example

Below is a complete, copy-pasteable endpoint: `GET/POST /api/counterparties` —
a per-user list of saved payment counterparties. It demonstrates every
convention in this guide: file structure, Zod validation, error handling, auth,
response envelope, and (route-level) rate limiting.

### Step 1 — Schema (`src/lib/validation-schemas.ts`)

```ts
// Add to src/lib/validation-schemas.ts

export const createCounterpartySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  stellarAddress: stellarAddress, // existing G… address validator
  memo: z.string().max(28).optional(),
});

export const counterpartyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
```

### Step 2 — Route (`src/app/api/counterparties/route.ts`)

```ts
// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getRateLimitStore } from "@/lib/rate-limit";
import {
  createCounterpartySchema,
  counterpartyQuerySchema,
} from "@/lib/validation-schemas";
import { withQueryRoute, withMutatingRoute } from "@/lib/api-wrapper";

export const GET = withQueryRoute(
  {
    route: "GET /api/counterparties",
    querySchema: counterpartyQuerySchema,
  },
  async ({ query, auth }) => {
    const where: {
      userId: string;
      name?: { contains: string; mode: "insensitive" };
    } = { userId: auth.userId };

    if (query.search) {
      where.name = { contains: query.search, mode: "insensitive" };
    }

    const items = await prisma.counterparty.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });

    return successResponse(items, { limit: query.limit });
  }
);

export const POST = withMutatingRoute(
  {
    route: "POST /api/counterparties",
    bodySchema: createCounterpartySchema,
  },
  async ({ body, auth }) => {
    // Stricter per-user limit than the global per-IP one (example of §7)
    const rate = await getRateLimitStore().increment(
      `user:${auth.userId}:counterparties`,
      60_000,
      30
    );
    if (!rate.allowed) {
      return errorResponse("RATE_LIMITED", "Too many requests", 429);
    }

    const item = await prisma.counterparty.create({
      data: {
        ...body,
        // Always derive ownership from auth — never trust a client-supplied userId
        userId: auth.userId,
      },
    });

    return successResponse(item, undefined, 201);
  }
);
```

> Note the `where` filter is always scoped to `auth.userId` — the single most
> important security rule in this codebase.

### Step 3 — Document it (`docs/openapi.yaml`)

Add the path and schemas under `paths:` and `components.schemas:`, following
the existing `Payments` entries, then reference the response schemas. See
[`docs/openapi.yaml`](./openapi.yaml) for the shape.

### Step 4 — Test it

See [§9](#9-testing-your-endpoint). At minimum, cover: unauthenticated → 401,
invalid body → 400 with `VALIDATION_ERROR`, valid create → 201 with the
envelope, and list → 200 scoped to the user.

---

## 9. Testing your endpoint

Every new endpoint ships with unit tests (Definition of Done for every issue):

- Place tests in `src/__tests__/` as `*.test.ts` (Vitest, already configured).
- **Mock the data layer and auth** so tests never touch a real database:

```ts
// src/__tests__/counterparties.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { counterparty: { findMany: vi.fn(), create: vi.fn() } },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

import { GET, POST } from "@/app/api/counterparties/route";
import prisma from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-session";

const mockedAuth = vi.mocked(getAuthContext);
const mockedFindMany = vi.mocked(prisma.counterparty.findMany);

beforeEach(() => {
  mockedAuth.mockResolvedValue({ userId: "user-1" });
  vi.clearAllMocks();
});

describe("GET /api/counterparties", () => {
  it("returns 401 without auth", async () => {
    mockedAuth.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/counterparties"));
    expect(res.status).toBe(401);
  });

  it("lists the authenticated user's counterparties", async () => {
    mockedFindMany.mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/counterparties"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(prisma.counterparty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });
});
```

Then run the full gate:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
```

---

## Checklist

Use this checklist before opening (or requesting review of) a PR that adds or
changes an API endpoint:

**Structure & Pipeline**
- [ ] Route file is `src/app/api/<resource>/route.ts` (plus `[id]/route.ts` only if needed)
- [ ] File starts with `// SPDX-License-Identifier: MIT`
- [ ] Handlers are named exports (`GET`/`POST`/`PATCH`/`DELETE`)
- [ ] Uses `withMutatingRoute` for mutations (`POST`, `PATCH`, `DELETE`, `PUT`) or `withQueryRoute` for reads (`GET`)
- [ ] Business logic lives in `src/lib/`, not in the route file

**Validation & Schema**
- [ ] All inputs validated with Zod via `bodySchema` and/or `querySchema`
- [ ] Reusable schemas added to `src/lib/validation-schemas.ts`
- [ ] Query params coerced with `z.coerce` and constrained (e.g. `limit` 1–100)
- [ ] Invalid input fails fast with HTTP 400 (`VALIDATION_ERROR`)

**Auth & Security**
- [ ] Authentication is strictly enforced by default; every query/mutation is scoped to `auth.userId`
- [ ] If bypassing authentication (public reads, webhooks), an explicit `optOutAuth` with a reviewable reason is declared
- [ ] CSRF protection is strictly enforced by default for mutating routes; if bypassing, an explicit `optOutCsrf` with a reviewable reason is declared
- [ ] Client-supplied `userId`/ownership fields are ignored in favor of `auth.userId`

**Errors & Observability**
- [ ] Handlers wrapped in pipeline wrappers (`withMutatingRoute` / `withQueryRoute`) ensuring metrics, logging, and `handleApiError` error translation
- [ ] No hand-rolled error bodies; helpers from `src/lib/api-response.ts` used
- [ ] Error codes reused from `src/lib/error-codes.ts` where applicable

**Response envelope**
- [ ] Success responses use `successResponse(data, meta?, status?)`
- [ ] Pagination metadata goes in `meta` (`limit`, `cursor`, `nextCursor`, `hasMore`, …)
- [ ] `jsonSafe` handles BigInt/Date (automatic via `successResponse`)

**Rate limiting**
- [ ] No per-route limiter added for standard routes (global proxy limit applies)
- [ ] Route-level limiter added only when a stricter/user-keyed limit is needed, using `getRateLimitStore()` + `rateLimitError()`

**Docs & tests**
- [ ] `docs/openapi.yaml` updated with the new/changed path and schemas
- [ ] Unit tests added in `src/__tests__/` covering auth, validation, success, and error paths
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
