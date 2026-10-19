// SPDX-License-Identifier: MIT

export interface StellarTestnetEnvironment {
  network: "testnet";
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  defaultServerUrl: string;
  testnetGatewayUrl: string;
}

export const STELLAR_TESTNET_ENV: StellarTestnetEnvironment = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  defaultServerUrl: "http://localhost:3000",
  testnetGatewayUrl: "https://testnet.api.ophirpay.com",
};

export interface OpenApiServer {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; description?: string; enum?: string[] }>;
  "x-stellar-network"?: string;
  "x-horizon-url"?: string;
  "x-soroban-rpc-url"?: string;
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  description?: string;
  example?: unknown;
  examples?: unknown[];
  default?: unknown;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  enum?: (string | number | boolean)[];
  nullable?: boolean;
  $ref?: string;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
  example?: unknown;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  $ref?: string;
  content?: Record<
    string,
    {
      schema?: OpenApiSchema;
      example?: unknown;
      examples?: Record<string, { value?: unknown }>;
    }
  >;
}

export interface OpenApiResponse {
  description: string;
  $ref?: string;
  content?: Record<
    string,
    {
      schema?: OpenApiSchema;
      example?: unknown;
      examples?: Record<string, { value?: unknown }>;
    }
  >;
}

export interface OpenApiOperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Record<string, string[]>[];
  deprecated?: boolean;
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  get?: OpenApiOperationObject;
  post?: OpenApiOperationObject;
  put?: OpenApiOperationObject;
  delete?: OpenApiOperationObject;
  patch?: OpenApiOperationObject;
  options?: OpenApiOperationObject;
  head?: OpenApiOperationObject;
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    termsOfService?: string;
    contact?: { name?: string; email?: string; url?: string };
    license?: { name: string; url?: string };
  };
  servers?: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    responses?: Record<string, OpenApiResponse>;
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    securitySchemes?: Record<string, unknown>;
  };
  security?: Record<string, string[]>[];
  tags?: { name: string; description?: string }[];
  "x-stellar-environment"?: StellarTestnetEnvironment;
}

export interface FlatEndpointOperation {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
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

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;

export function resolveJsonPointer(doc: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let current: unknown = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    const decoded = part.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[decoded];
  }
  return current;
}

export function resolveSchema(doc: OpenApiDocument, schema?: OpenApiSchema): OpenApiSchema | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const resolved = resolveJsonPointer(doc, schema.$ref) as OpenApiSchema | undefined;
    if (resolved) {
      return resolveSchema(doc, resolved);
    }
  }
  if (schema.properties) {
    const props: Record<string, OpenApiSchema> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      props[k] = resolveSchema(doc, v) ?? v;
    }
    return { ...schema, properties: props };
  }
  if (schema.items) {
    return { ...schema, items: resolveSchema(doc, schema.items) ?? schema.items };
  }
  return schema;
}

export function synthesizeSampleFromSchema(schema?: OpenApiSchema): unknown {
  if (!schema) return {};
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case "string":
      if (schema.format === "date-time") return new Date().toISOString();
      if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      return "sample_string";
    case "number":
    case "integer":
      return 100;
    case "boolean":
      return true;
    case "array":
      return schema.items ? [synthesizeSampleFromSchema(schema.items)] : [];
    case "object": {
      const obj: Record<string, unknown> = {};
      if (schema.properties) {
        for (const [k, prop] of Object.entries(schema.properties)) {
          obj[k] = synthesizeSampleFromSchema(prop);
        }
      }
      return obj;
    }
    default:
      return {};
  }
}

export function extractOpenApiOperations(spec: OpenApiDocument): FlatEndpointOperation[] {
  const results: FlatEndpointOperation[] = [];
  const docSecurity = spec.security;

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;

    const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

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
        else mergedParams.push(p);
      }

      const effectiveSecurity = rawOp.security !== undefined ? rawOp.security : docSecurity;
      const requiresAuth = Array.isArray(effectiveSecurity) && effectiveSecurity.length > 0;

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
