// SPDX-License-Identifier: MIT
/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import type { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-session";
import {
  badRequestError,
  conflictError,
  unauthorizedError,
  validationError,
  handleApiError,
} from "@/lib/api-response";
import { hasScope, missingScopes, type ApiScope } from "@/lib/api-auth";
import { formatProblemDetails } from "@/lib/api-errors";
import { verifyCsrf } from "@/lib/csrf";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { idempotencyKeySchema } from "@/lib/validation-schemas";
import { claimIdempotencyKey } from "@/lib/idempotency";
import { ERROR_CODES } from "@/lib/error-codes";

/** Header that makes a mutation safely retryable (issue #1440). */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** What a caller sees when the key is already being processed. */
export const IDEMPOTENCY_IN_PROGRESS_MESSAGE =
  "A request with this Idempotency-Key is already being processed. Retry after the indicated delay.";

/**
 * Read and validate the required `Idempotency-Key` header.
 *
 * Every POST that can move funds requires one: without it, a network retry or
 * a double-clicked submit creates a second payment/escrow/stream on-chain, and
 * the client has no safe way to retry a request whose response it never saw.
 *
 * A missing or malformed key is rejected *before* any work happens, and never
 * silently replaced by a generated value — a server-generated key makes every
 * retry a fresh mutation, which is the exact failure this guard exists to
 * prevent.
 *
 * @example
 * ```ts
 * const idempotency = requireIdempotencyKey(request);
 * if (!idempotency.ok) return idempotency.response;
 * return withIdempotency(request, { userId: auth.userId, key: idempotency.key }, async () => {
 *   // … create the record …
 * });
 * ```
 */
export function requireIdempotencyKey(
  request: Request
): { ok: true; key: string } | { ok: false; response: Response } {
  const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER.toLowerCase());
  if (raw === null) {
    return {
      ok: false,
      response: badRequestError(
        `${IDEMPOTENCY_KEY_HEADER} header is required for this request. ` +
          "Send a unique value per logical operation and reuse it when retrying."
      ),
    };
  }
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationError(parsed.error) };
  }
  return { ok: true, key: parsed.data };
}

/**
 * Run a mutation at most once per `(userId, key)`.
 *
 * The first request claims a short lease, runs the handler and caches its
 * successful response for 24 h (`IDEMPOTENCY_RESPONSE_TTL_SECONDS`). Any
 * later request carrying the same key is answered with
 * **HTTP 409 Conflict and the byte-identical body of the original response**
 * (plus `Idempotency-Replay: true` and `X-Original-Status`), which is what
 * lets a retrying client reconcile instead of submitting a second payment.
 * A concurrent duplicate that is still in flight gets 409 with `Retry-After`.
 *
 * Failures are never cached: a handler that throws or returns a non-2xx
 * releases the lease immediately, so the client can correct the request and
 * retry with the same key. Without Redis the handler still runs (the route
 * keeps whatever durable guarantee it has); correctness of the money movement
 * never depends on the cache being available.
 */
export async function withIdempotency(
  request: Request,
  options: { userId: string; key: string },
  handler: (request: Request) => Promise<Response> | Response
): Promise<Response> {
  const { userId, key } = options;
  const claim = await claimIdempotencyKey(userId, key);

  if (claim.status === "replay") {
    // Deliberately 409, not the original 2xx: the caller must be able to tell
    // "your earlier attempt already happened" from "this attempt succeeded",
    // or a retry loop looks successful twice. The body is exactly what the
    // first attempt returned.
    return Response.json(claim.response.body, {
      status: 409,
      headers: {
        "Idempotency-Replay": "true",
        "X-Original-Status": String(claim.response.status),
      },
    });
  }

  if (claim.status === "in-flight") {
    return conflictError(
      IDEMPOTENCY_IN_PROGRESS_MESSAGE,
      { "Retry-After": String(claim.retryAfterSeconds) },
      ERROR_CODES.OPERATION_IN_PROGRESS
    );
  }

  let response: Response;
  try {
    response = await handler(request);
  } catch (err) {
    // Never pin the key on an exception — that would turn a transient 500 into
    // a 24 h outage for this operation.
    if (claim.status === "acquired") await claim.release().catch(() => {});
    throw err;
  }

  if (claim.status !== "acquired") return response;

  if (!response.ok) {
    await claim.release();
    return response;
  }

  try {
    await claim.remember({
      status: response.status,
      body: await response.clone().json(),
    });
  } catch {
    // A non-JSON success body cannot be replayed; free the key so the next
    // retry can at least reach the route's own guards.
    await claim.release();
  }
  return response;
}

/** The authenticated context produced by `getAuthContext`. */
export interface ScopeAuthContext {
  /** Present only when the request authenticated with an API key. */
  keyId?: string;
  /** Scopes carried by that API key. */
  scopes?: string[];
}

/**
 * Enforce a granular API-key scope on a route.
 *
 * Browser sessions (signed session cookie) are the account owner and are not
 * scope-limited; scopes exist for delegated, machine-to-machine API keys, which
 * `getAuthContext` marks with a `keyId`. A key without the required scope gets
 * an RFC 9457 `application/problem+json` 403 naming the exact missing
 * permission, rather than merely a generic forbidden response.
 *
 * Usage, after the route has established an authenticated user:
 *
 * ```ts
 * const auth = await getAuthContext(request);
 * if (!auth) return unauthorizedError();
 * const scopeError = await requireScope(request, "batches:create", auth);
 * if (scopeError) return scopeError;
 * ```
 */
export async function requireScope(
  request: Request,
  scope: ApiScope,
  auth: ScopeAuthContext
): Promise<NextResponse | null> {
  // Cookie-authenticated browser sessions belong to the resource owner.
  if (!auth.keyId) return null;

  if (hasScope(auth.scopes, [scope])) return null;

  const missing = missingScopes(auth.scopes, [scope]);
  const missingList = missing.length > 0 ? missing : [scope];

  return formatProblemDetails({
    status: 403,
    code: ERROR_CODES.INSUFFICIENT_SCOPE,
    title: "Insufficient scope",
    detail:
      `This API key lacks the required scope: ${missingList.join(", ")}. ` +
      `Grant the key the "${scope}" scope (or "admin") and retry.`,
    instance: new URL(request.url).pathname,
    extensions: {
      missingScope: missingList[0],
      missingScopes: missingList,
      requiredScopes: [scope],
    },
  });
}

export interface ApiRouteOptions<TBody extends z.ZodTypeAny = any, TQuery extends z.ZodTypeAny = any> {
  /** The name of the route for metrics, e.g. "GET /api/payments" */
  name?: string;
  /** Whether to require authentication. Default is true. Use "opt-out" for public routes. */
  auth?: boolean | "opt-out";
  /** Whether to verify CSRF for mutating methods (POST, PUT, PATCH, DELETE). Default is true. Use "opt-out" for exempt routes. */
  csrf?: boolean | "opt-out";
  /** Schema to parse the request body. */
  bodySchema?: TBody;
  /** Schema to parse the search params. */
  querySchema?: TQuery;
}

export interface ApiRouteContext<TBody = any, TQuery = any, TParams = any> {
  params: TParams;
  auth: NonNullable<Awaited<ReturnType<typeof getAuthContext>>> | null;
  body: TBody | undefined;
  query: TQuery | undefined;
}

export function apiRoute<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = any
>(
  options: ApiRouteOptions<TBody, TQuery>,
  handler: (
    request: Request,
    ctx: ApiRouteContext<z.infer<TBody>, z.infer<TQuery>, TParams>
  ) => Promise<Response> | Response
) {
  const wrappedHandler = async (request: Request, { params }: { params: Promise<TParams> }) => {
    try {
      // 1. CSRF Verification
      if (options.csrf !== "opt-out" && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        const csrfError = verifyCsrf(request);
        if (csrfError) return csrfError;
      }

      // 2. Authentication
      let auth = null;
      if (options.auth !== "opt-out") {
        auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError("Authentication required. Connect your wallet or provide an API key.");
        }
      }

      // 3. Body Parsing
      let parsedBody: any = undefined;
      if (options.bodySchema) {
        let rawBody;
        try {
          rawBody = await request.json();
        } catch {
          return validationError(new z.ZodError([{ path: ["body"], message: "Invalid JSON", code: "custom" }]));
        }
        const parsed = options.bodySchema.safeParse(rawBody);
        if (!parsed.success) return validationError(parsed.error);
        parsedBody = parsed.data;
      }

      // 4. Query Parsing
      let parsedQuery: any = undefined;
      if (options.querySchema) {
        const url = new URL(request.url);
        const searchParams = Object.fromEntries(url.searchParams.entries());
        const parsed = options.querySchema.safeParse(searchParams);
        if (!parsed.success) return validationError(parsed.error);
        parsedQuery = parsed.data;
      }

      const awaitedParams = params ? await params : undefined as any;

      return await handler(request, {
        params: awaitedParams,
        auth,
        body: parsedBody as z.infer<TBody>,
        query: parsedQuery as z.infer<TQuery>,
      });
    } catch (err) {
      return handleApiError(err, options.name || `${request.method} ${request.url}`);
    }
  };

  const loggedHandler = withRequestLogging(wrappedHandler as any);
  return options.name ? withMetrics(options.name, loggedHandler) : loggedHandler;
}
