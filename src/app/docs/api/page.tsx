"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo, useCallback } from "react";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  STELLAR_TESTNET_ENV,
  extractOpenApiOperations,
  resolveSchema,
  buildRequestUrl,
  buildCurlSnippet,
  type OpenApiDocument,
  type FlatEndpointOperation,
  type OpenApiSchema,
} from "@/lib/openapi-schema";

const METHOD_BADGE_STYLES: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
  POST: "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-300 dark:border-blue-800",
  PATCH:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800",
  PUT: "bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800",
  DELETE:
    "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800",
};

interface TryItOutResult {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

function formatSchemaType(schema: OpenApiSchema | undefined): string {
  if (!schema) return "any";
  if (schema.$ref) return schema.$ref.replace("#/components/schemas/", "");
  if (schema.enum && schema.enum.length > 0) {
    return `enum(${schema.enum.map(String).join(" | ")})`;
  }
  const baseType = Array.isArray(schema.type)
    ? schema.type.join(" | ")
    : schema.type || "object";
  if (baseType === "array" && schema.items) {
    return `${formatSchemaType(schema.items)}[]`;
  }
  if (schema.format) {
    return `${baseType} (${schema.format})`;
  }
  return baseType;
}

function SchemaViewer({ schema }: { schema: OpenApiSchema | undefined }) {
  if (!schema) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        No structured schema declared.
      </p>
    );
  }

  if (schema.properties && Object.keys(schema.properties).length > 0) {
    const requiredSet = new Set(schema.required ?? []);
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900/70 text-gray-600 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Required</th>
              <th className="px-3 py-2 font-semibold">Description / Constraints</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
            {Object.entries(schema.properties).map(([propName, propSchema]) => (
              <tr key={propName}>
                <td className="px-3 py-2 font-mono font-medium text-gray-900 dark:text-gray-100">
                  {propName}
                </td>
                <td className="px-3 py-2 font-mono text-ophir-600 dark:text-ophir-400">
                  {formatSchemaType(propSchema)}
                </td>
                <td className="px-3 py-2">
                  {requiredSet.has(propName) ? (
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">
                      required
                    </span>
                  ) : (
                    <span className="text-gray-400">optional</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {propSchema.description || "—"}
                  {propSchema.pattern ? (
                    <span className="ml-1 font-mono text-[11px] text-gray-500">
                      pattern: {propSchema.pattern}
                    </span>
                  ) : null}
                  {propSchema.default !== undefined ? (
                    <span className="ml-1 font-mono text-[11px] text-gray-500">
                      default: {String(propSchema.default)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <pre className="text-xs font-mono bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto">
      {JSON.stringify(schema, null, 2)}
    </pre>
  );
}

export interface OpenApiReferenceViewProps {
  initialSpec?: OpenApiDocument;
}

export function OpenApiReferenceView({ initialSpec }: OpenApiReferenceViewProps) {
  const [spec, setSpec] = useState<OpenApiDocument | null>(initialSpec ?? null);
  const [loading, setLoading] = useState<boolean>(!initialSpec);
  const [error, setError] = useState<string | null>(null);

  // Filters & navigation
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [selectedMethod, setSelectedMethod] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<"endpoints" | "schemas">("endpoints");

  // Stellar Testnet "Try it out" configuration
  const [serverUrl, setServerUrl] = useState<string>(STELLAR_TESTNET_ENV.defaultServerUrl);
  const [apiKey, setApiKey] = useState<string>("");
  const [authMode, setAuthMode] = useState<"bearer" | "header">("bearer");

  // Expanded operation & Try It Out state
  const [expandedOps, setExpandedOps] = useState<Record<string, boolean>>({});
  const [tryItOutOpen, setTryItOutOpen] = useState<Record<string, boolean>>({});
  const [pathInputs, setPathInputs] = useState<Record<string, Record<string, string>>>({});
  const [queryInputs, setQueryInputs] = useState<Record<string, Record<string, string>>>({});
  const [bodyInputs, setBodyInputs] = useState<Record<string, string>>({});
  const [executingOp, setExecutingOp] = useState<Record<string, boolean>>({});
  const [tryResults, setTryResults] = useState<Record<string, TryItOutResult>>({});

  const loadSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/openapi.json", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to load OpenAPI spec`);
      }
      const data = (await response.json()) as OpenApiDocument;
      setSpec(data);
      if (data.servers && data.servers.length > 0 && data.servers[0].url) {
        setServerUrl(data.servers[0].url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OpenAPI specification");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSpec) {
      void loadSpec();
    }
  }, [initialSpec, loadSpec]);

  const operations = useMemo<FlatEndpointOperation[]>(() => {
    if (!spec) return [];
    return extractOpenApiOperations(spec);
  }, [spec]);

  const allTags = useMemo<string[]>(() => {
    const tagSet = new Set<string>();
    for (const t of spec?.tags ?? []) {
      if (t.name) tagSet.add(t.name);
    }
    for (const op of operations) {
      for (const t of op.tags) tagSet.add(t);
    }
    return Array.from(tagSet);
  }, [spec, operations]);

  const filteredOperations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return operations.filter((op) => {
      if (selectedTag !== "ALL" && !op.tags.includes(selectedTag)) {
        return false;
      }
      if (selectedMethod !== "ALL" && op.method !== selectedMethod) {
        return false;
      }
      if (!q) return true;
      return (
        op.path.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q) ||
        op.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [operations, searchQuery, selectedTag, selectedMethod]);

  const componentSchemas = useMemo(() => {
    if (!spec?.components?.schemas) return [];
    return Object.entries(spec.components.schemas).map(([name, schema]) => ({
      name,
      schema: resolveSchema(spec, schema) ?? schema,
    }));
  }, [spec]);

  const toggleExpandOp = (opId: string) => {
    setExpandedOps((prev) => ({ ...prev, [opId]: !prev[opId] }));
  };

  const toggleTryItOut = (op: FlatEndpointOperation) => {
    const nextState = !tryItOutOpen[op.id];
    setTryItOutOpen((prev) => ({ ...prev, [op.id]: nextState }));
    setExpandedOps((prev) => ({ ...prev, [op.id]: true }));

    if (nextState && op.sampleRequestBody && bodyInputs[op.id] === undefined) {
      setBodyInputs((prev) => ({ ...prev, [op.id]: op.sampleRequestBody ?? "{}" }));
    }
  };

  const executeTryItOut = async (op: FlatEndpointOperation) => {
    const targetUrl = buildRequestUrl(
      serverUrl,
      op.path,
      pathInputs[op.id] ?? {},
      queryInputs[op.id] ?? {}
    );

    setExecutingOp((prev) => ({ ...prev, [op.id]: true }));
    const start = performance.now();

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Stellar-Network": STELLAR_TESTNET_ENV.network,
      };

      if (apiKey.trim()) {
        if (authMode === "bearer") {
          headers["Authorization"] = `Bearer ${apiKey.trim()}`;
        } else {
          headers["X-API-Key"] = apiKey.trim();
        }
      }

      const init: RequestInit = {
        method: op.method,
        headers,
      };

      const rawBody = bodyInputs[op.id] ?? op.sampleRequestBody;
      if (rawBody && ["POST", "PUT", "PATCH", "DELETE"].includes(op.method)) {
        headers["Content-Type"] = "application/json";
        init.body = rawBody;
      }

      // If targeting local server in browser, use relative path for same-origin fetch
      const fetchUrl =
        typeof window !== "undefined" && targetUrl.startsWith("http://localhost:3000")
          ? targetUrl.replace("http://localhost:3000", "")
          : targetUrl;

      const res = await fetch(fetchUrl, init);
      const durationMs = Math.round(performance.now() - start);
      const responseText = await res.text();
      let formattedBody = responseText;
      try {
        formattedBody = JSON.stringify(JSON.parse(responseText), null, 2);
      } catch {
        // Leave non-JSON body as text
      }

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        resHeaders[key] = value;
      });

      setTryResults((prev) => ({
        ...prev,
        [op.id]: {
          status: res.status,
          statusText: res.statusText || (res.ok ? "OK" : "Error"),
          durationMs,
          headers: resHeaders,
          body: formattedBody,
        },
      }));
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      setTryResults((prev) => ({
        ...prev,
        [op.id]: {
          status: 0,
          statusText: "Network Error",
          durationMs,
          headers: {},
          body: "",
          error: err instanceof Error ? err.message : "Request failed",
        },
      }));
    } finally {
      setExecutingOp((prev) => ({ ...prev, [op.id]: false }));
    }
  };

  const uniquePathCount = spec ? Object.keys(spec.paths ?? {}).length : 0;

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1.5">
          <Breadcrumb items={[{ label: "Docs" }, { label: "API Reference" }]} />
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {spec?.info?.title ?? "OphirPay API"} — Interactive Reference
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-ophir-100 text-ophir-800 dark:bg-ophir-950 dark:text-ophir-300 border border-ophir-300 dark:border-ophir-800">
              OpenAPI {spec?.openapi ?? "3.1.0"}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              Stellar Testnet Ready
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl">
            Explore all {uniquePathCount || "40+"} API paths ({operations.length || "80+"}{" "}
            operations), inspect request and response schemas, and execute live &ldquo;Try it
            out&rdquo; requests against the Stellar Testnet environment.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <span>Raw JSON Spec (/api/openapi.json)</span>
          </a>
        </div>
      </div>

      {/* Stellar Testnet Environment & Authentication Configuration */}
      <Card className="p-4 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <span>Stellar Testnet &ldquo;Try it out&rdquo; Environment</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                {STELLAR_TESTNET_ENV.networkPassphrase}
              </span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Horizon:{" "}
              <code className="font-mono text-gray-700 dark:text-gray-300">
                {STELLAR_TESTNET_ENV.horizonUrl}
              </code>{" "}
              · Soroban RPC:{" "}
              <code className="font-mono text-gray-700 dark:text-gray-300">
                {STELLAR_TESTNET_ENV.sorobanRpcUrl}
              </code>
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
            <span>
              Paths: <strong className="text-gray-900 dark:text-white">{uniquePathCount}</strong>
            </span>
            <span>·</span>
            <span>
              Operations:{" "}
              <strong className="text-gray-900 dark:text-white">{operations.length}</strong>
            </span>
            <span>·</span>
            <span>
              Schemas:{" "}
              <strong className="text-gray-900 dark:text-white">{componentSchemas.length}</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Target Server Selector */}
          <div>
            <label
              htmlFor="openapi-server-select"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Target API Server (Stellar Testnet)
            </label>
            <select
              id="openapi-server-select"
              aria-label="Target API Server"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            >
              {(spec?.servers && spec.servers.length > 0
                ? spec.servers
                : [
                    {
                      url: STELLAR_TESTNET_ENV.defaultServerUrl,
                      description: "Stellar Testnet (Local Development Gateway)",
                    },
                    {
                      url: STELLAR_TESTNET_ENV.testnetGatewayUrl,
                      description: "Stellar Testnet API Environment",
                    },
                  ]
              ).map((srv) => (
                <option key={srv.url} value={srv.url}>
                  {srv.url} — {srv.description ?? "Server"}
                </option>
              ))}
            </select>
          </div>

          {/* Auth Header Mode */}
          <div>
            <label
              htmlFor="openapi-auth-mode"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Authentication Header Mode
            </label>
            <select
              id="openapi-auth-mode"
              aria-label="Authentication Header Mode"
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as "bearer" | "header")}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            >
              <option value="bearer">Authorization: Bearer &lt;api-key&gt;</option>
              <option value="header">X-API-Key: &lt;api-key&gt;</option>
            </select>
          </div>

          {/* API Key Input */}
          <div>
            <label
              htmlFor="openapi-api-key"
              className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              API Key / Bearer Token (optional for Try it out)
            </label>
            <input
              id="openapi-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="oph_test_..."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            />
          </div>
        </div>
      </Card>

      {/* Search, Method Filter, Tag Filter & View Switcher */}
      <Card className="p-4 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <input
              type="search"
              aria-label="Search API endpoints"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter 40+ endpoints by path (/api/payments, /api/escrows), summary, or tag..."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(["ALL", "GET", "POST", "PATCH", "PUT", "DELETE"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setSelectedMethod(method)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  selectedMethod === method
                    ? "bg-ophir-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {method}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-gray-200 dark:border-gray-800 pl-3">
            <button
              type="button"
              onClick={() => setActiveTab("endpoints")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "endpoints"
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              Endpoints ({filteredOperations.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("schemas")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === "schemas"
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              Schemas ({componentSchemas.length})
            </button>
          </div>
        </div>

        {/* Tag Pills */}
        {allTags.length > 0 && activeTab === "endpoints" && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            <button
              type="button"
              onClick={() => setSelectedTag("ALL")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedTag === "ALL"
                  ? "bg-ophir-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              All Tags
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedTag === tag
                    ? "bg-ophir-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Loading & Error states */}
      {loading && (
        <Card className="p-8 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Loading OpenAPI specification from <code>/api/openapi.json</code>...
          </p>
        </Card>
      )}

      {error && (
        <Card className="p-6 border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                Could not load OpenAPI specification
              </h3>
              <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadSpec()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
            >
              Retry
            </button>
          </div>
        </Card>
      )}

      {/* Endpoints Reference View */}
      {!loading && !error && activeTab === "endpoints" && (
        <div className="space-y-3" data-testid="openapi-endpoints-list">
          {filteredOperations.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No endpoints match your current filter.
              </p>
            </Card>
          ) : (
            filteredOperations.map((op) => {
              const isExpanded = Boolean(expandedOps[op.id]);
              const isTryOpen = Boolean(tryItOutOpen[op.id]);
              const pathParams = op.parameters.filter((p) => p.in === "path");
              const queryParams = op.parameters.filter((p) => p.in === "query");
              const currentUrl = buildRequestUrl(
                serverUrl,
                op.path,
                pathInputs[op.id] ?? {},
                queryInputs[op.id] ?? {}
              );
              const curlSnippet = buildCurlSnippet({
                method: op.method,
                url: currentUrl,
                apiKey,
                requiresAuth: op.requiresAuth,
                body: bodyInputs[op.id] ?? op.sampleRequestBody,
              });
              const result = tryResults[op.id];

              return (
                <Card
                  key={op.id}
                  className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 overflow-hidden"
                >
                  <div data-testid={`endpoint-card-${op.method}-${op.path}`}>
                  {/* Summary Row */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpandOp(op.id)}
                      aria-expanded={isExpanded}
                      className="flex items-center gap-3 text-left flex-1 min-w-0"
                    >
                      <span
                        className={`px-2.5 py-1 rounded text-xs font-mono font-bold border shrink-0 ${
                          METHOD_BADGE_STYLES[op.method] ??
                          "bg-gray-100 text-gray-800 border-gray-300"
                        }`}
                      >
                        {op.method}
                      </span>
                      <code className="font-mono text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {op.path}
                      </code>
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate hidden md:inline">
                        — {op.summary}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {op.tags.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                        >
                          {t}
                        </span>
                      ))}
                      {op.requiresAuth ? (
                        <span
                          title="Requires API Key or Bearer authentication"
                          className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                        >
                          Auth
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          Public
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleTryItOut(op)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-ophir-600 text-white hover:bg-ophir-700 transition-colors"
                      >
                        {isTryOpen ? "Close Try it out" : "Try it out"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpandOp(op.id)}
                        className="px-2 py-1 rounded text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Documentation & Try It Out Section */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-5 bg-gray-50/40 dark:bg-gray-950/40">
                      {op.description && (
                        <div className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-line leading-relaxed">
                          {op.description}
                        </div>
                      )}

                      {/* Parameters */}
                      {op.parameters.length > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Parameters ({op.parameters.length})
                          </h3>
                          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                            <table className="min-w-full text-left text-xs">
                              <thead className="bg-gray-50 dark:bg-gray-900/70 text-gray-600 dark:text-gray-400">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Name</th>
                                  <th className="px-3 py-2 font-semibold">In</th>
                                  <th className="px-3 py-2 font-semibold">Type</th>
                                  <th className="px-3 py-2 font-semibold">Required</th>
                                  <th className="px-3 py-2 font-semibold">Description</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-950">
                                {op.parameters.map((param) => (
                                  <tr key={`${param.in}-${param.name}`}>
                                    <td className="px-3 py-2 font-mono font-medium text-gray-900 dark:text-gray-100">
                                      {param.name}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-gray-500">
                                      {param.in}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-ophir-600 dark:text-ophir-400">
                                      {formatSchemaType(param.schema)}
                                    </td>
                                    <td className="px-3 py-2">
                                      {param.required ? (
                                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                                          required
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">optional</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                                      {param.description || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Request Body Schema */}
                      {op.resolvedRequestSchema && (
                        <div className="space-y-2">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Request Body Schema (application/json)
                          </h3>
                          <SchemaViewer schema={op.resolvedRequestSchema} />
                        </div>
                      )}

                      {/* Responses */}
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Responses ({Object.keys(op.responses).length})
                        </h3>
                        <div className="space-y-2">
                          {Object.entries(op.responses).map(([statusCode, resp]) => (
                            <div
                              key={statusCode}
                              className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-3 space-y-2"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                                    statusCode.startsWith("2")
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                      : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                  }`}
                                >
                                  {statusCode}
                                </span>
                                <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                                  {resp.description}
                                </span>
                              </div>
                              {resp.schema && <SchemaViewer schema={resp.schema} />}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Interactive Stellar Testnet "Try it out" Console */}
                      {isTryOpen && (
                        <div
                          data-testid={`try-it-out-panel-${op.id}`}
                          className="rounded-xl border-2 border-ophir-500/40 bg-white dark:bg-gray-900 p-4 space-y-4"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-ophir-600 dark:text-ophir-400">
                                Interactive Console — Stellar Testnet
                              </h4>
                              <p className="text-xs font-mono text-gray-500 mt-0.5">{currentUrl}</p>
                            </div>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                              X-Stellar-Network: {STELLAR_TESTNET_ENV.network}
                            </span>
                          </div>

                          {/* Path Parameter Inputs */}
                          {pathParams.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {pathParams.map((p) => (
                                <div key={p.name}>
                                  <label className="block text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                                    Path: {p.name} *
                                  </label>
                                  <input
                                    type="text"
                                    value={pathInputs[op.id]?.[p.name] ?? ""}
                                    onChange={(e) =>
                                      setPathInputs((prev) => ({
                                        ...prev,
                                        [op.id]: {
                                          ...(prev[op.id] ?? {}),
                                          [p.name]: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder={`Enter ${p.name}...`}
                                    className="w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-2.5 py-1.5 text-xs font-mono"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Query Parameter Inputs */}
                          {queryParams.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {queryParams.map((p) => (
                                <div key={p.name}>
                                  <label className="block text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                                    Query: {p.name}
                                  </label>
                                  <input
                                    type="text"
                                    value={queryInputs[op.id]?.[p.name] ?? ""}
                                    onChange={(e) =>
                                      setQueryInputs((prev) => ({
                                        ...prev,
                                        [op.id]: {
                                          ...(prev[op.id] ?? {}),
                                          [p.name]: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder={
                                      p.schema?.default !== undefined
                                        ? String(p.schema.default)
                                        : `Optional ${p.name}`
                                    }
                                    className="w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-2.5 py-1.5 text-xs font-mono"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* JSON Request Body Editor */}
                          {["POST", "PUT", "PATCH", "DELETE"].includes(op.method) &&
                            (op.requestBody || op.sampleRequestBody) && (
                              <div>
                                <label className="block text-xs font-mono text-gray-700 dark:text-gray-300 mb-1">
                                  Request Body (JSON)
                                </label>
                                <textarea
                                  rows={6}
                                  aria-label={`Request body for ${op.id}`}
                                  value={bodyInputs[op.id] ?? op.sampleRequestBody ?? "{}"}
                                  onChange={(e) =>
                                    setBodyInputs((prev) => ({
                                      ...prev,
                                      [op.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-950 text-gray-100 p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ophir-500"
                                />
                              </div>
                            )}

                          {/* Generated curl command */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                                cURL Command (Stellar Testnet)
                              </span>
                              <CopyButton value={curlSnippet} label="Copy cURL" />
                            </div>
                            <pre className="text-xs font-mono bg-gray-950 text-emerald-300 p-3 rounded-lg overflow-x-auto">
                              {curlSnippet}
                            </pre>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              disabled={Boolean(executingOp[op.id])}
                              onClick={() => void executeTryItOut(op)}
                              className="px-4 py-2 rounded-lg text-xs font-semibold bg-ophir-600 text-white hover:bg-ophir-700 disabled:opacity-50 transition-colors"
                            >
                              {executingOp[op.id]
                                ? "Sending Request..."
                                : `Execute ${op.method} ${op.path}`}
                            </button>
                          </div>

                          {/* Live Response Output */}
                          {result && (
                            <div
                              data-testid={`try-it-out-result-${op.id}`}
                              className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-3"
                            >
                              <div className="flex items-center gap-3 text-xs">
                                <span className="font-semibold text-gray-700 dark:text-gray-300">
                                  Response Status:
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded font-mono font-bold ${
                                    result.status >= 200 && result.status < 300
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                      : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                  }`}
                                >
                                  {result.status > 0
                                    ? `${result.status} ${result.statusText}`
                                    : result.statusText}
                                </span>
                                <span className="text-gray-500 font-mono">
                                  {result.durationMs} ms
                                </span>
                              </div>
                              {result.error ? (
                                <p className="text-xs text-rose-600 dark:text-rose-400 font-mono">
                                  {result.error}
                                </p>
                              ) : (
                                <pre className="text-xs font-mono bg-gray-950 text-gray-100 p-3 rounded-lg overflow-x-auto max-h-96">
                                  {result.body || "(empty response body)"}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* Component Schemas View */}
      {!loading && !error && activeTab === "schemas" && (
        <div className="space-y-4" data-testid="openapi-schemas-list">
          {componentSchemas.map(({ name, schema }) => (
            <Card
              key={name}
              className="p-4 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/90 space-y-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-bold text-gray-900 dark:text-white">
                  {name}
                </h3>
                <span className="text-xs font-mono text-gray-500">
                  #/components/schemas/{name}
                </span>
              </div>
              {schema.description && (
                <p className="text-xs text-gray-600 dark:text-gray-400">{schema.description}</p>
              )}
              <SchemaViewer schema={schema} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  return <OpenApiReferenceView />;
}
