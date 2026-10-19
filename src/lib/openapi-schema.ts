// SPDX-License-Identifier: MIT

export const STELLAR_TESTNET_ENV = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  defaultServerUrl: "http://localhost:3000",
  testnetGatewayUrl: "https://testnet.api.ophirpay.com",
} as const;

export interface OpenApiServer {
  url: string;
  description?: string;
  "x-stellar-network"?: string;
  "x-horizon-url"?: string;
  "x-soroban-rpc-url"?: string;
}

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<
    string,
    {
      summary?: string;
      description?: string;
      value?: unknown;
    }
  >;
}

export interface OpenApiRequestBody {
  $ref?: string;
  required?: boolean;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  $ref?: string;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: { name?: string; url?: string; email?: string };
    license?: { name: string; url?: string };
  };
  servers?: OpenApiServer[];
  security?: Array<Record<string, string[]>>;
  tags?: OpenApiTag[];
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, OpenApiSchema>;
    responses?: Record<string, OpenApiResponse>;
    "x-error-codes"?: Record<string, string[]>;
  };
  "x-stellar-environment"?: typeof STELLAR_TESTNET_ENV;
}

export interface FlatEndpointOperation {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  tags: string[];
  summary: string;
  description: string;
  requiresAuth: boolean;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  resolvedRequestSchema?: OpenApiSchema;
  sampleRequestBody?: string;
  responses: Record<
    string,
    {
      description: string;
      schema?: OpenApiSchema;
      example?: unknown;
    }
  >;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Resolve a `#/...` JSON pointer against the OpenAPI document.
 */
export function resolveJsonPointer(spec: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((cur, segment) => {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
        return undefined;
      }
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return (cur as Record<string, unknown>)[key];
    }, spec);
}

/**
 * Recursively resolve `$ref` pointers inside an OpenAPI schema object.
 */
export function resolveSchema(
  spec: OpenApiDocument,
  schema: OpenApiSchema | undefined,
  seen: Set<string> = new Set()
): OpenApiSchema | undefined {
  if (!schema) return undefined;

  if (schema.$ref) {
    if (seen.has(schema.$ref)) {
      return { type: "object", description: `Circular ref: ${schema.$ref}` };
    }
    const target = resolveJsonPointer(spec, schema.$ref) as OpenApiSchema | undefined;
    if (!target) return schema;
    const nextSeen = new Set(seen);
    nextSeen.add(schema.$ref);
    return resolveSchema(spec, target, nextSeen);
  }

  const resolved: OpenApiSchema = { ...schema };

  if (schema.properties) {
    const resolvedProps: Record<string, OpenApiSchema> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      resolvedProps[key] = resolveSchema(spec, propSchema, seen) ?? propSchema;
    }
    resolved.properties = resolvedProps;
  }

  if (schema.items) {
    resolved.items = resolveSchema(spec, schema.items, seen) ?? schema.items;
  }

  return resolved;
}

/**
 * Synthesize a realistic sample value from an OpenAPI schema for "Try it out".
 */
export function synthesizeSampleFromSchema(schema: OpenApiSchema | undefined): unknown {
  if (!schema) return {};
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const primaryType = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (primaryType) {
    case "string":
      if (schema.format === "date-time") return "2026-03-01T12:00:00Z";
      if (schema.format === "uri") return "https://example.com/webhooks/ophirpay";
      if (schema.pattern?.includes("G[A-Z0-9]")) {
        return "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
      }
      return "sample_value";
    case "integer":
    case "number":
      return schema.minimum && schema.minimum > 0 ? schema.minimum : 100;
    case "boolean":
      return true;
    case "array":
      return schema.items ? [synthesizeSampleFromSchema(schema.items)] : [];
    case "object":
    default: {
      if (!schema.properties) return {};
      const out: Record<string, unknown> = {};
      for (const [k, prop] of Object.entries(schema.properties)) {
        out[k] = synthesizeSampleFromSchema(prop);
      }
      return out;
    }
  }
}

/**
 * Extract all operations from the OpenAPI document in a normalized flat list
 * with resolved request/response schemas and sample payloads.
 */
export function extractOpenApiOperations(spec: OpenApiDocument): FlatEndpointOperation[] {
  const results: FlatEndpointOperation[] = [];
  const docSecurity = spec.security;

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;

    const pathParams = Array.isArray((pathItem as { parameters?: unknown }).parameters)
      ? ((pathItem as { parameters: OpenApiParameter[] }).parameters ?? [])
      : [];

    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method] as OpenApiOperationObject | undefined;
      if (!rawOp || typeof rawOp !== "object") continue;

      const opParams = Array.isArray(rawOp.parameters) ? rawOp.parameters : [];
      const mergedParams: OpenApiParameter[] = [...pathParams];
      for (const p of opParams) {
        const idx = mergedParams.findIndex(
          (existing) => existing.name === p.name && existing.in === p.in
        );
        if (idx >= 0) mergedParams[idx] = p;
        else mergedParams[pushIndex(mergedParams)] = p;
      }

      const effectiveSecurity = rawOp.security !== undefined ? rawOp.security : docSecurity;
      const requiresAuth = Array.isArray(effectiveSecurity) && effectiveSecurity.length > 0;

      // Resolve request body schema and sample JSON
      let resolvedRequestSchema: OpenApiSchema | undefined;
      let sampleRequestBody: string | undefined;

      if (rawOp.requestBody) {
        const reqBody = rawOp.requestBody.$ref
          ? (resolveJsonPointer(spec, rawOp.requestBody.$ref) as OpenApiRequestBody | undefined)
          : rawOp.requestBody;
        const content = reqBody?.content;
        const media =
          content?.["application/json"] ??
          (content ? Object.values(content)[0] : undefined);

        if (media?.schema) {
          resolvedRequestSchema = resolveSchema(spec, media.schema);
        }

        const firstNamedExample = media?.examples
          ? Object.values(media.examples)[0]?.value
          : undefined;
        const rawSample =
          media?.example ??
          firstNamedExample ??
          (resolvedRequestSchema ? synthesizeSampleFromSchema(resolvedRequestSchema) : undefined);

        if (rawSample !== undefined) {
          sampleRequestBody = JSON.stringify(rawSample, null, 2);
        }
      }

      // Resolve responses
      const responses: FlatEndpointOperation["responses"] = {};
      for (const [statusCode, respObj] of Object.entries(rawOp.responses ?? {})) {
        const resolvedResp = respObj.$ref
          ? (resolveJsonPointer(spec, respObj.$ref) as OpenApiResponse | undefined)
          : respObj;
        const media =
          resolvedResp?.content?.["application/json"] ??
          (resolvedResp?.content ? Object.values(resolvedResp.content)[0] : undefined);
        const firstExample = media?.examples
          ? Object.values(media.examples)[0]?.value
          : media?.example;

        responses[statusCode] = {
          description: resolvedResp?.description ?? "Response",
          schema: resolveSchema(spec, media?.schema),
          example: firstExample,
        };
      }

      results.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase() as FlatEndpointOperation["method"],
        path,
        tags: Array.isArray(rawOp.tags) && rawOp.tags.length > 0 ? rawOp.tags : ["General"],
        summary: rawOp.summary ?? `${method.toUpperCase()} ${path}`,
        description: rawOp.description?.trim() ?? "",
        requiresAuth,
        parameters: mergedParams,
        requestBody: rawOp.requestBody,
        resolvedRequestSchema,
        sampleRequestBody,
        responses,
      });
    }
  }

  return results;
}

function pushIndex<T>(arr: T[]): number {
  return arr.length;
}

/**
 * Resolve path and query parameters into a target URL string.
 */
export function buildRequestUrl(
  baseUrl: string,
  specPath: string,
  pathValues: Record<string, string>,
  queryValues: Record<string, string>
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const resolvedPath = specPath.replace(/\{([^}]+)\}/g, (_, paramName: string) => {
    const val = pathValues[paramName]?.trim();
    return encodeURIComponent(val && val.length > 0 ? val : `sample-${paramName}`);
  });

  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(queryValues)) {
    if (v !== undefined && v.trim() !== "") {
      search.set(k, v.trim());
    }
  }
  const qs = search.toString();
  return `${normalizedBase}${resolvedPath}${qs ? `?${qs}` : ""}`;
}

/**
 * Generate a copy-pasteable curl snippet for the "Try it out" panel.
 */
export function buildCurlSnippet(options: {
  method: string;
  url: string;
  apiKey?: string;
  requiresAuth: boolean;
  body?: string;
}): string {
  const lines: string[] = [`curl -X ${options.method} "${options.url}"`];
  lines.push(`  -H "Accept: application/json"`);
  lines.push(`  -H "X-Stellar-Network: ${STELLAR_TESTNET_ENV.network}"`);
  if (options.requiresAuth || (options.apiKey && options.apiKey.trim().length > 0)) {
    const token = options.apiKey?.trim() || "<YOUR_STELLAR_TESTNET_API_KEY>";
    lines.push(`  -H "Authorization: Bearer ${token}"`);
  }
  if (
    options.body &&
    options.body.trim().length > 0 &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(options.method)
  ) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${options.body.replace(/'/g, "'\\''")}'`);
  }
  return lines.join(" \\\n");
}
