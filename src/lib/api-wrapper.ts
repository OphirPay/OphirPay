// SPDX-License-Identifier: MIT

/**
 * Standardized API Route Wrappers & Pipeline for Next.js App Router.
 *
 * Encodes the required security pipeline once:
 *   1. Metrics recording (`withMetrics`)
 *   2. Structured request logging with request-ID propagation (`withRequestLogging`)
 *   3. Central error mapping and production masking (`handleApiError`)
 *   4. CSRF protection on mutating routes (`verifyCsrf`) — mandatory unless explicit opt-out
 *   5. Authentication and scope validation (`getAuthContext`) — mandatory unless explicit opt-out
 *   6. Zod schema validation for request bodies and query parameters (`validationError`)
 *
 * @see docs/API_GUIDE.md
 */

import { z } from "zod";
import { getAuthContext, type AuthContext } from "@/lib/auth-session";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf, registerCsrfOptOut } from "@/lib/csrf";
import {
  validationError,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { type ApiScope } from "@/lib/api-scopes";
import { requireScopes } from "@/lib/api-auth";

// ── Opt-Out Contracts ──────────────────────────────────────────

export interface OptOut {
  reason: string;
}

export type OptOutOption = string | OptOut;

/**
 * Validates and extracts a reviewable reason string from an opt-out declaration.
 * Throws immediately if an empty or blank reason is supplied.
 */
export function normalizeOptOutReason(
  optOut: OptOutOption | undefined,
  field: "optOutAuth" | "optOutCsrf"
): string | null {
  if (optOut === undefined || optOut === null) return null;
  const reason = typeof optOut === "string" ? optOut.trim() : optOut.reason?.trim();
  if (!reason) {
    throw new Error(
      `Explicit ${field} requires a non-empty, reviewable reason explaining why security controls are bypassed.`
    );
  }
  return reason;
}

// ── Composable Helper: withAuth ────────────────────────────────

export interface WithAuthOptions {
  requiredScopes?: ApiScope | ApiScope[];
  errorMessage?: string;
}

/**
 * Composable wrapper: Enforces authentication (wallet session or API key)
 * and optional API scopes on any route handler.
 */
export function withAuth<
  TContext extends Record<string, unknown> = Record<string, unknown>
>(
  handler: (
    request: Request,
    context: TContext & { auth: AuthContext }
  ) => Promise<Response>,
  options?: WithAuthOptions
) {
  return async (
    request: Request,
    context?: TContext
  ): Promise<Response> => {
    const auth = await getAuthContext(request);
    if (!auth) {
      return unauthorizedError(
        options?.errorMessage ??
          "Authentication required. Connect your wallet or provide an API key."
      );
    }

    if (options?.requiredScopes && auth.keyId) {
      const scopeRes = await requireScopes(request, options.requiredScopes);
      if (!("userId" in scopeRes)) return scopeRes;
    }

    const merged = { ...(context ?? {}), auth } as TContext & { auth: AuthContext };
    return handler(request, merged);
  };
}

// ── Composable Helper: withValidation ──────────────────────────

export interface WithValidationOptions<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny
> {
  bodySchema?: TBody;
  querySchema?: TQuery;
}

/**
 * Extract searchParams from a Request URL as a plain key-value object.
 */
export function extractSearchParams(urlStr: string): Record<string, string | undefined> {
  const url = new URL(urlStr);
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value ?? undefined;
  }
  return result;
}

/**
 * Composable wrapper: Enforces Zod schema parsing for query params and/or request body.
 * Fails fast with standard 400 validationError when inputs do not match schema.
 */
export function withValidation<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TContext extends Record<string, unknown> = Record<string, unknown>
>(
  options: WithValidationOptions<TBody, TQuery>,
  handler: (
    request: Request,
    context: TContext & {
      body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
      query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
    }
  ) => Promise<Response>
) {
  return async (
    request: Request,
    context?: TContext
  ): Promise<Response> => {
    let parsedQuery: unknown = undefined;
    if (options.querySchema) {
      const rawQuery = extractSearchParams(request.url);
      const res = options.querySchema.safeParse(rawQuery);
      if (!res.success) return validationError(res.error);
      parsedQuery = res.data;
    }

    let parsedBody: unknown = undefined;
    if (options.bodySchema) {
      const rawBody = await request.json().catch(() => null);
      const res = options.bodySchema.safeParse(rawBody ?? {});
      if (!res.success) return validationError(res.error);
      parsedBody = res.data;
    }

    const merged = {
      ...(context ?? {}),
      body: parsedBody as TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined,
      query: parsedQuery as TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined,
    } as TContext & {
      body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
      query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
    };

    return handler(request, merged);
  };
}

// ── Unified Mutating Route Pipeline: withMutatingRoute ─────────

export interface MutatingRouteConfig<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny
> {
  /** Route descriptor for metrics and error logs, e.g. "POST /api/payments/retry" */
  route: string;
  /** Schema for parsing JSON request body */
  bodySchema?: TBody;
  /** Schema for parsing URL search parameters */
  querySchema?: TQuery;
  /** Scopes required if caller authenticates with API key */
  requiredScopes?: ApiScope | ApiScope[];
  /**
   * Explicit opt-out for authentication (e.g. public webhook receiving).
   * MUST provide a non-empty string or `{ reason: string }`.
   */
  optOutAuth?: OptOutOption;
  /**
   * Explicit opt-out for CSRF protection (e.g. cron triggers with x-cron-secret).
   * MUST provide a non-empty string or `{ reason: string }`.
   */
  optOutCsrf?: OptOutOption;
}

export interface MutatingHandlerContext<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = Record<string, string>
> {
  request: Request;
  auth: AuthContext;
  body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
  query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
  params: TParams;
}

export interface MutatingHandlerContextPublic<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = Record<string, string>
> {
  request: Request;
  auth?: AuthContext | null;
  body: TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined;
  query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
  params: TParams;
}

/**
 * Pipeline wrapper for mutating App Router endpoints (POST, PATCH, DELETE, PUT).
 *
 * Automatically guarantees:
 *   1. Metrics histogram recording (`withMetrics`)
 *   2. Request-ID threaded logging (`withRequestLogging`)
 *   3. Catch-all `handleApiError` error translation
 *   4. CSRF protection verification (`verifyCsrf`) — fails closed unless `optOutCsrf` is specified
 *   5. Authentication (`getAuthContext`) — fails closed unless `optOutAuth` is specified
 *   6. Zod input validation (`validationError`)
 *   7. Next.js 15 async route `params` resolution
 */
export function withMutatingRoute<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = Record<string, string>
>(
  config: MutatingRouteConfig<TBody, TQuery>,
  handler: (
    context: MutatingHandlerContext<TBody, TQuery, TParams>
  ) => Promise<Response>
): (
  request: Request,
  routeContext?: { params?: Promise<TParams> | TParams }
) => Promise<Response> {
  // Validate and register opt-outs at definition time
  const authOptOutReason = normalizeOptOutReason(config.optOutAuth, "optOutAuth");
  const csrfOptOutReason = normalizeOptOutReason(config.optOutCsrf, "optOutCsrf");

  if (csrfOptOutReason) {
    const parts = config.route.split(" ");
    const method = parts.length > 1 ? parts[0]! : "POST";
    const path = parts.length > 1 ? parts[1]! : parts[0]!;
    registerCsrfOptOut(path, method, csrfOptOutReason);
  }

  const coreHandler = async (
    request: Request,
    routeContext?: { params?: Promise<TParams> | TParams }
  ): Promise<Response> => {
    try {
      // 1. CSRF Verification (mutations only)
      if (!csrfOptOutReason) {
        const csrfError = verifyCsrf(request);
        if (csrfError) return csrfError;
      }

      // 2. Authentication Verification
      let auth: AuthContext | null = null;
      if (!authOptOutReason) {
        auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError(
            "Authentication required. Connect your wallet or provide an API key."
          );
        }

        if (config.requiredScopes && auth.keyId) {
          const scopeRes = await requireScopes(request, config.requiredScopes);
          if (!("userId" in scopeRes)) return scopeRes;
        }
      } else {
        // Optional auth resolution for public routes that can be user-aware
        auth = await getAuthContext(request);
      }

      // 3. Query Validation
      let query: unknown = undefined;
      if (config.querySchema) {
        const rawQuery = extractSearchParams(request.url);
        const parsedQuery = config.querySchema.safeParse(rawQuery);
        if (!parsedQuery.success) return validationError(parsedQuery.error);
        query = parsedQuery.data;
      }

      // 4. Body Validation
      let body: unknown = undefined;
      if (config.bodySchema) {
        const rawBody = await request.json().catch(() => null);
        const parsedBody = config.bodySchema.safeParse(rawBody ?? {});
        if (!parsedBody.success) return validationError(parsedBody.error);
        body = parsedBody.data;
      }

      // 5. Route Params resolution (handles async params in Next.js 15)
      const rawParams = routeContext?.params;
      const params = (
        rawParams instanceof Promise ? await rawParams : (rawParams ?? {})
      ) as TParams;

      // 6. Invoke handler with typed pipeline context
      return await handler({
        request,
        auth: auth as AuthContext,
        body: body as TBody extends z.ZodTypeAny ? z.infer<TBody> : undefined,
        query: query as TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined,
        params,
      });
    } catch (err) {
      return handleApiError(err, config.route);
    }
  };

  return withMetrics(config.route, withRequestLogging(coreHandler));
}

// ── Unified Query Route Pipeline: withQueryRoute ───────────────

export interface QueryRouteConfig<
  TQuery extends z.ZodTypeAny = z.ZodTypeAny
> {
  /** Route descriptor for metrics and error logs, e.g. "GET /api/payments" */
  route: string;
  /** Schema for parsing URL search parameters */
  querySchema?: TQuery;
  /** Scopes required if caller authenticates with API key */
  requiredScopes?: ApiScope | ApiScope[];
  /**
   * Explicit opt-out for authentication (e.g. public health / stats endpoint).
   * MUST provide a non-empty string or `{ reason: string }`.
   */
  optOutAuth?: OptOutOption;
}

export interface QueryHandlerContext<
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = Record<string, string>
> {
  request: Request;
  auth: AuthContext;
  query: TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined;
  params: TParams;
}

/**
 * Pipeline wrapper for read-only App Router endpoints (GET, HEAD).
 *
 * Automatically guarantees:
 *   1. Metrics histogram recording (`withMetrics`)
 *   2. Request-ID threaded logging (`withRequestLogging`)
 *   3. Catch-all `handleApiError` error translation
 *   4. Authentication (`getAuthContext`) — fails closed unless `optOutAuth` is specified
 *   5. Zod searchParams validation (`validationError`)
 *   6. Next.js 15 async route `params` resolution
 */
export function withQueryRoute<
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TParams = Record<string, string>
>(
  config: QueryRouteConfig<TQuery>,
  handler: (
    context: QueryHandlerContext<TQuery, TParams>
  ) => Promise<Response>
): (
  request: Request,
  routeContext?: { params?: Promise<TParams> | TParams }
) => Promise<Response> {
  const authOptOutReason = normalizeOptOutReason(config.optOutAuth, "optOutAuth");

  const coreHandler = async (
    request: Request,
    routeContext?: { params?: Promise<TParams> | TParams }
  ): Promise<Response> => {
    try {
      // 1. Authentication Verification
      let auth: AuthContext | null = null;
      if (!authOptOutReason) {
        auth = await getAuthContext(request);
        if (!auth) {
          return unauthorizedError(
            "Authentication required. Connect your wallet or provide an API key."
          );
        }

        if (config.requiredScopes && auth.keyId) {
          const scopeRes = await requireScopes(request, config.requiredScopes);
          if (!("userId" in scopeRes)) return scopeRes;
        }
      } else {
        auth = await getAuthContext(request);
      }

      // 2. Query Validation
      let query: unknown = undefined;
      if (config.querySchema) {
        const rawQuery = extractSearchParams(request.url);
        const parsedQuery = config.querySchema.safeParse(rawQuery);
        if (!parsedQuery.success) return validationError(parsedQuery.error);
        query = parsedQuery.data;
      }

      // 3. Route Params resolution
      const rawParams = routeContext?.params;
      const params = (
        rawParams instanceof Promise ? await rawParams : (rawParams ?? {})
      ) as TParams;

      return await handler({
        request,
        auth: auth as AuthContext,
        query: query as TQuery extends z.ZodTypeAny ? z.infer<TQuery> : undefined,
        params,
      });
    } catch (err) {
      return handleApiError(err, config.route);
    }
  };

  return withMetrics(config.route, withRequestLogging(coreHandler));
}
