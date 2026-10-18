// SPDX-License-Identifier: MIT
/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { getAuthContext } from "@/lib/auth-session";
import { unauthorizedError, validationError, handleApiError } from "@/lib/api-response";
import { verifyCsrf } from "@/lib/csrf";
import { withMetrics } from "@/lib/metrics-middleware";
import { withRequestLogging } from "@/lib/request-logging";
import {
  checkIdempotency,
  saveIdempotencyRecord,
} from "@/lib/idempotency";

export * from "@/lib/idempotency";

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
  /** Whether to enforce request idempotency key on POST mutation routes (issue #1302). */
  idempotency?: boolean | { required?: boolean; scope?: string; ttlMs?: number };
}

export interface ApiRouteContext<TBody = any, TQuery = any, TParams = any> {
  params: TParams;
  auth: NonNullable<Awaited<ReturnType<typeof getAuthContext>>> | null;
  body: TBody | undefined;
  query: TQuery | undefined;
  idempotencyKey?: string | null;
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

      // 3. Idempotency Check (issue #1302)
      let idempotencyKey: string | null = null;
      const idempotencyOpt = options.idempotency;
      const shouldCheckIdempotency = Boolean(idempotencyOpt) && request.method === "POST";
      if (shouldCheckIdempotency) {
        const scope =
          (typeof idempotencyOpt === "object" && idempotencyOpt.scope) ||
          options.name ||
          "mutation";
        const check = await checkIdempotency(request, scope, auth?.userId);
        if ("errorResponse" in check) {
          return check.errorResponse;
        }
        if (check.isDuplicate) {
          return check.conflictResponse;
        }
        idempotencyKey = check.key;
      }

      // 4. Body Parsing
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

      // 5. Query Parsing
      let parsedQuery: any = undefined;
      if (options.querySchema) {
        const url = new URL(request.url);
        const searchParams = Object.fromEntries(url.searchParams.entries());
        const parsed = options.querySchema.safeParse(searchParams);
        if (!parsed.success) return validationError(parsed.error);
        parsedQuery = parsed.data;
      }

      const awaitedParams = params ? await params : (undefined as any);

      const response = await handler(request, {
        params: awaitedParams,
        auth,
        body: parsedBody as z.infer<TBody>,
        query: parsedQuery as z.infer<TQuery>,
        idempotencyKey,
      });

      // Save successful response for idempotency caching if enabled
      if (idempotencyKey && response.ok) {
        const scope =
          (typeof idempotencyOpt === "object" && idempotencyOpt.scope) ||
          options.name ||
          "mutation";
        try {
          const clone = response.clone();
          const json = await clone.json();
          await saveIdempotencyRecord(idempotencyKey, scope, json, response.status, auth?.userId);
        } catch {
          // Non-JSON response or body already read; skip caching
        }
      }

      return response;
    } catch (err) {
      return handleApiError(err, options.name || `${request.method} ${request.url}`);
    }
  };

  const loggedHandler = withRequestLogging(wrappedHandler as any);
  return options.name ? withMetrics(options.name, loggedHandler) : loggedHandler;
}
