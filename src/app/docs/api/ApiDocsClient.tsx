// SPDX-License-Identifier: MIT
"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Spinner } from "@/components/ui/Spinner";

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: {
    type?: string;
    format?: string;
    default?: unknown;
    enum?: unknown[];
    items?: { type?: string };
  };
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content?: {
    [mediaType: string]: {
      schema?: Record<string, unknown>;
      examples?: Record<string, { summary?: string; value?: unknown }>;
    };
  };
}

export interface ResponseObject {
  description?: string;
  content?: {
    [mediaType: string]: {
      schema?: Record<string, unknown>;
      examples?: Record<string, { summary?: string; value?: unknown }>;
    };
  };
  $ref?: string;
}

export interface OperationObject {
  summary?: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiSpecData {
  openapi?: string;
  info?: {
    title?: string;
    description?: string;
    version?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths?: Record<string, Record<string, OperationObject>>;
  security?: Array<Record<string, string[]>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

interface FlattenedOperation {
  id: string;
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  tag: string;
  summary: string;
  description: string;
  parameters: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
  isProtected: boolean;
  raw: OperationObject;
}

const METHOD_COLORS = {
  GET: {
    badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    border: "border-blue-500/20 hover:border-blue-500/50",
    pill: "bg-blue-600 text-white",
    bgHover: "hover:bg-blue-500/5",
  },
  POST: {
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    border: "border-emerald-500/20 hover:border-emerald-500/50",
    pill: "bg-emerald-600 text-white",
    bgHover: "hover:bg-emerald-500/5",
  },
  PUT: {
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    border: "border-amber-500/20 hover:border-amber-500/50",
    pill: "bg-amber-600 text-white",
    bgHover: "hover:bg-amber-500/5",
  },
  PATCH: {
    badge: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    border: "border-purple-500/20 hover:border-purple-500/50",
    pill: "bg-purple-600 text-white",
    bgHover: "hover:bg-purple-500/5",
  },
  DELETE: {
    badge: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    border: "border-rose-500/20 hover:border-rose-500/50",
    pill: "bg-rose-600 text-white",
    bgHover: "hover:bg-rose-500/5",
  },
};

interface ExecutionResult {
  loading: boolean;
  status?: number;
  statusText?: string;
  durationMs?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

export function ApiDocsClient({ initialSpec }: { initialSpec?: OpenApiSpecData | null }) {
  const [spec, setSpec] = useState<OpenApiSpecData | null>(initialSpec || null);
  const [loadingSpec, setLoadingSpec] = useState(!initialSpec);
  const [specError, setSpecError] = useState<string | null>(null);

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<string>("ALL");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [expandedOps, setExpandedOps] = useState<Record<string, boolean>>({});

  // Server & Auth configuration state
  const [selectedServer, setSelectedServer] = useState<string>("http://localhost:3000");
  const [authMethod, setAuthMethod] = useState<"bearer" | "apiKey">("bearer");
  const [authToken, setAuthToken] = useState<string>("");
  const [authSaved, setAuthSaved] = useState<boolean>(false);

  // Try-It-Out parameters & results keyed by operation ID
  const [tryParams, setTryParams] = useState<Record<string, Record<string, string>>>({});
  const [tryBodies, setTryBodies] = useState<Record<string, string>>({});
  const [tryResults, setTryResults] = useState<Record<string, ExecutionResult>>({});

  // Load spec from route if not provided via SSR
  useEffect(() => {
    if (!initialSpec) {
      setLoadingSpec(true);
      fetch("/api/openapi.json")
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load OpenAPI spec`);
          return res.json();
        })
        .then((data) => {
          setSpec(data);
          if (data.servers && data.servers.length > 0) {
            setSelectedServer(data.servers[0].url);
          }
          setLoadingSpec(false);
        })
        .catch((err) => {
          setSpecError(err.message);
          setLoadingSpec(false);
        });
    } else if (initialSpec.servers && initialSpec.servers.length > 0) {
      setSelectedServer(initialSpec.servers[0].url);
    }
  }, [initialSpec]);

  // Flatten all operations
  const operations = useMemo<FlattenedOperation[]>(() => {
    if (!spec || !spec.paths) return [];
    const list: FlattenedOperation[] = [];

    const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;

      for (const methodKey of HTTP_METHODS) {
        const op = pathItem[methodKey];
        if (!op || typeof op !== "object") continue;

        const method = methodKey.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        const opTag = (op.tags && op.tags[0]) || "General";
        const opId = op.operationId || `${method.toLowerCase()}_${pathKey.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // Merge path-level parameters with operation parameters
        const pathParams = (pathItem as { parameters?: ParameterObject[] }).parameters || [];
        const opParams = op.parameters || [];
        const combinedParams: ParameterObject[] = [...pathParams];
        for (const p of opParams) {
          if (!combinedParams.some((cp) => cp.name === p.name && cp.in === p.in)) {
            combinedParams.push(p);
          }
        }

        const isProtected = Boolean(
          (op.security && op.security.length > 0) ||
          (spec.security && spec.security.length > 0 && op.security === undefined)
        );

        list.push({
          id: opId,
          path: pathKey,
          method,
          tag: opTag,
          summary: op.summary || `${method} ${pathKey}`,
          description: op.description || "",
          parameters: combinedParams,
          requestBody: op.requestBody,
          responses: op.responses || {},
          isProtected,
          raw: op,
        });
      }
    }

    return list;
  }, [spec]);

  // List of all unique tags
  const tagsList = useMemo(() => {
    const tags = new Set<string>();
    for (const op of operations) {
      tags.add(op.tag);
    }
    return Array.from(tags).sort();
  }, [operations]);

  // Filtered operations
  const filteredOperations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return operations.filter((op) => {
      if (selectedMethod !== "ALL" && op.method !== selectedMethod) return false;
      if (selectedTag !== "ALL" && op.tag !== selectedTag) return false;
      if (!q) return true;

      return (
        op.path.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q) ||
        op.tag.toLowerCase().includes(q)
      );
    });
  }, [operations, searchQuery, selectedMethod, selectedTag]);

  // Toggle single operation expansion
  const toggleOperation = useCallback((id: string) => {
    setExpandedOps((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Expand / collapse all
  const toggleAll = useCallback((expand: boolean) => {
    const next: Record<string, boolean> = {};
    for (const op of operations) {
      next[op.id] = expand;
    }
    setExpandedOps(next);
  }, [operations]);

  // Update a parameter for try-it-out
  const handleParamChange = useCallback((opId: string, paramName: string, value: string) => {
    setTryParams((prev) => ({
      ...prev,
      [opId]: {
        ...(prev[opId] || {}),
        [paramName]: value,
      },
    }));
  }, []);

  // Update body for try-it-out
  const handleBodyChange = useCallback((opId: string, body: string) => {
    setTryBodies((prev) => ({
      ...prev,
      [opId]: body,
    }));
  }, []);

  // Compute live URL for an operation
  const computeUrl = useCallback(
    (op: FlattenedOperation) => {
      let resolvedPath = op.path;
      const opParams = tryParams[op.id] || {};
      const queryParts: string[] = [];

      for (const p of op.parameters) {
        const val = opParams[p.name];
        if (p.in === "path") {
          resolvedPath = resolvedPath.replace(`{${p.name}}`, encodeURIComponent(val || `{${p.name}}`));
        } else if (p.in === "query" && val !== undefined && val !== "") {
          queryParts.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(val)}`);
        }
      }

      const queryString = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
      const base = selectedServer.replace(/\/$/, "");
      return `${base}${resolvedPath}${queryString}`;
    },
    [selectedServer, tryParams]
  );

  // Compute live curl command preview
  const computeCurlCommand = useCallback(
    (op: FlattenedOperation) => {
      const url = computeUrl(op);
      const parts = [`curl -X ${op.method} "${url}"`];

      if (authToken) {
        if (authMethod === "bearer") {
          parts.push(`  -H "Authorization: Bearer ${authToken}"`);
        } else {
          parts.push(`  -H "X-API-Key: ${authToken}"`);
        }
      }

      if (["POST", "PUT", "PATCH"].includes(op.method)) {
        parts.push(`  -H "Content-Type: application/json"`);
        const bodyContent = tryBodies[op.id];
        if (bodyContent && bodyContent.trim()) {
          // Escape single quotes for bash
          const escaped = bodyContent.replace(/'/g, "'\\''");
          parts.push(`  -d '${escaped}'`);
        }
      }

      return parts.join(" \\\n");
    },
    [computeUrl, authToken, authMethod, tryBodies]
  );

  // Execute request for Try It Out
  const executeRequest = useCallback(
    async (op: FlattenedOperation) => {
      const url = computeUrl(op);
      setTryResults((prev) => ({
        ...prev,
        [op.id]: { loading: true },
      }));

      const headers: Record<string, string> = {};

      if (authToken) {
        if (authMethod === "bearer") {
          headers["Authorization"] = `Bearer ${authToken}`;
        } else {
          headers["X-API-Key"] = authToken;
        }
      }

      const isBodyMethod = ["POST", "PUT", "PATCH"].includes(op.method);
      let requestBody: string | undefined = undefined;

      if (isBodyMethod) {
        headers["Content-Type"] = "application/json";
        const rawBody = tryBodies[op.id];
        if (rawBody && rawBody.trim()) {
          requestBody = rawBody;
        }
      }

      const startTime = performance.now();

      try {
        const response = await fetch(url, {
          method: op.method,
          headers,
          body: requestBody,
        });

        const durationMs = Math.round(performance.now() - startTime);
        const resHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          resHeaders[key] = val;
        });

        const text = await response.text();
        let formattedBody = text;
        try {
          const parsedJson = JSON.parse(text);
          formattedBody = JSON.stringify(parsedJson, null, 2);
        } catch {
          // Keep raw text
        }

        setTryResults((prev) => ({
          ...prev,
          [op.id]: {
            loading: false,
            status: response.status,
            statusText: response.statusText,
            durationMs,
            headers: resHeaders,
            body: formattedBody,
          },
        }));
      } catch (err: unknown) {
        const durationMs = Math.round(performance.now() - startTime);
        const errMsg = err instanceof Error ? err.message : String(err);
        setTryResults((prev) => ({
          ...prev,
          [op.id]: {
            loading: false,
            durationMs,
            error: errMsg.includes("Failed to fetch")
              ? "Network or CORS error: verify the server is reachable and permits cross-origin requests."
              : errMsg,
          },
        }));
      }
    },
    [computeUrl, authToken, authMethod, tryBodies]
  );

  if (loadingSpec) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Spinner className="w-10 h-10 text-ophir-500 animate-spin" />
        <p className="text-gray-500 dark:text-gray-400 font-medium">Loading OphirPay API Specification...</p>
      </div>
    );
  }

  if (specError) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl">
        <h2 className="text-xl font-bold text-rose-700 dark:text-rose-400 mb-2">Error Loading OpenAPI Specification</h2>
        <p className="text-gray-700 dark:text-gray-300 mb-4">{specError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-20">
      {/* ── Page Header & Info ─────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800/60 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                OphirPay API Reference
              </h1>
              <Badge variant="info" className="font-mono text-xs">
                OpenAPI {spec?.openapi || "3.1.0"}
              </Badge>
              <Badge variant="success" className="font-mono text-xs">
                v{spec?.info?.version || "0.1.0"}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 max-w-3xl leading-relaxed">
              Interactive OpenAPI documentation & testing client for the OphirPay Stellar payment orchestration layer.
              Directly explore, execute, and validate requests against Stellar Testnet nodes and local APIs with complete CSP compliance.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/api/openapi.json"
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              title="Inspect raw OpenAPI JSON specification"
            >
              <svg className="w-4 h-4 text-ophir-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Raw Spec (JSON)
            </Link>
            <Link
              href="https://github.com/OphirPay/OphirPay/blob/main/docs/API_GUIDE.md"
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              title="Read the API Guide"
            >
              <svg className="w-4 h-4 text-stellar" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              API Guide
            </Link>
          </div>
        </div>

        {/* ── Environment & Global Authentication Controls ──────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* Target Server Switcher */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Target Server (Environment)
            </label>
            <div className="relative">
              <select
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
                className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-ophir-500 focus:outline-none"
              >
                {(spec?.servers || []).map((srv) => (
                  <option key={srv.url} value={srv.url}>
                    {srv.description ? `${srv.description} (${srv.url})` : srv.url}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Interactive calls will be directed to this base endpoint.
            </p>
          </div>

          {/* Global Auth Header Configuration */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Authentication
              </label>
              {authSaved && authToken ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  Active Token Attached
                </span>
              ) : (
                <span className="text-xs text-gray-400">No token saved</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={authMethod}
                onChange={(e) => setAuthMethod(e.target.value as "bearer" | "apiKey")}
                className="bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ophir-500"
              >
                <option value="bearer">Bearer Token</option>
                <option value="apiKey">X-API-Key</option>
              </select>
              <input
                type="password"
                placeholder={authMethod === "bearer" ? "Enter Bearer token or secret..." : "Enter ophir_key_..."}
                value={authToken}
                onChange={(e) => {
                  setAuthToken(e.target.value);
                  setAuthSaved(false);
                }}
                className="flex-1 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-ophir-500 focus:outline-none"
              />
              <button
                onClick={() => setAuthSaved(true)}
                disabled={!authToken}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-ophir-600 text-white hover:bg-ophir-700 disabled:opacity-50 transition"
              >
                Save
              </button>
              {authToken && (
                <button
                  onClick={() => {
                    setAuthToken("");
                    setAuthSaved(false);
                  }}
                  className="px-2 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  title="Clear token"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Attached to requests requiring authentication (`Authorization: Bearer` or `X-API-Key`).
            </p>
          </div>
        </div>
      </div>

      {/* ── Toolbar: Search, Filters & Counters ──────────────────── */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-center gap-4 justify-between">
          {/* Search Input */}
          <div className="relative w-full md:w-96">
            <svg
              className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by path, summary, or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg pl-9 pr-8 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-ophir-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* Method Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap w-full md:w-auto">
            {["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => {
              const active = selectedMethod === m;
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    active
                      ? "bg-ophir-600 text-white shadow-sm"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleAll(true)}
              className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg transition"
            >
              Expand All
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg transition"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Tag Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 text-xs">
          <span className="text-gray-400 font-semibold uppercase tracking-wider text-[10px] shrink-0">Tags:</span>
          <button
            onClick={() => setSelectedTag("ALL")}
            className={`px-2.5 py-1 rounded-md shrink-0 font-medium transition ${
              selectedTag === "ALL"
                ? "bg-stellar text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            All Tags ({operations.length})
          </button>
          {tagsList.map((tag) => {
            const count = operations.filter((op) => op.tag === tag).length;
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-2.5 py-1 rounded-md shrink-0 font-medium transition ${
                  active
                    ? "bg-stellar text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {tag} ({count})
              </button>
            );
          })}
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800/60">
          Showing <span className="font-semibold text-gray-900 dark:text-white">{filteredOperations.length}</span> of{" "}
          <span className="font-semibold text-gray-900 dark:text-white">{operations.length}</span> endpoints
        </div>
      </div>

      {/* ── Endpoints List ────────────────────────────────────────── */}
      <div className="space-y-4">
        {filteredOperations.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl">
            <p className="text-gray-500 dark:text-gray-400 text-base font-medium">
              No API endpoints matched your query &ldquo;{searchQuery}&rdquo;.
            </p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedMethod("ALL");
                setSelectedTag("ALL");
              }}
              className="mt-3 text-sm text-ophir-600 dark:text-ophir-400 font-semibold hover:underline"
            >
              Reset filters
            </button>
          </div>
        ) : (
          filteredOperations.map((op) => {
            const isExpanded = expandedOps[op.id] ?? false;
            const colors = METHOD_COLORS[op.method] || METHOD_COLORS.GET;
            const opTryParams = tryParams[op.id] || {};
            const opBody = tryBodies[op.id] ?? "";
            const result = tryResults[op.id];
            const curlPreview = computeCurlCommand(op);

            return (
              <div
                key={op.id}
                className={`bg-white dark:bg-gray-900 border ${colors.border} rounded-2xl overflow-hidden shadow-sm transition-all duration-200`}
              >
                {/* Endpoint Header Row (Click to Expand) */}
                <div
                  onClick={() => toggleOperation(op.id)}
                  className={`p-4 flex items-center justify-between gap-4 cursor-pointer select-none ${colors.bgHover} transition-colors`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleOperation(op.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-bold border font-mono tracking-wide ${colors.badge}`}
                    >
                      {op.method}
                    </span>
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {op.path}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate hidden md:inline">
                      — {op.summary}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hidden sm:inline">
                      {op.tag}
                    </span>
                    {op.isProtected && (
                      <span
                        className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1"
                        title="Requires Authentication"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Auth
                      </span>
                    )}
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Expanded Endpoint Body */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800/80 p-5 space-y-6 bg-gray-50/50 dark:bg-gray-950/40">
                    {/* Description */}
                    {op.description && (
                      <div className="prose dark:prose-invert max-w-none text-xs text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed">
                        {op.description}
                      </div>
                    )}

                    {/* Parameters Table & Inputs */}
                    {op.parameters.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                          Parameters
                        </h4>
                        <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                              <tr>
                                <th className="px-3 py-2 font-semibold">Name</th>
                                <th className="px-3 py-2 font-semibold">In</th>
                                <th className="px-3 py-2 font-semibold">Type</th>
                                <th className="px-3 py-2 font-semibold">Description</th>
                                <th className="px-3 py-2 font-semibold min-w-[200px]">Value (Try it out)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-mono">
                              {op.parameters.map((p) => {
                                const val = opTryParams[p.name] ?? "";
                                return (
                                  <tr key={`${p.in}-${p.name}`} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30">
                                    <td className="px-3 py-2 font-bold text-gray-900 dark:text-white">
                                      {p.name}
                                      {p.required && <span className="text-rose-500 ml-1 font-sans">*</span>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-500">{p.in}</td>
                                    <td className="px-3 py-2 text-gray-500">{p.schema?.type || "string"}</td>
                                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 font-sans">
                                      {p.description || "—"}
                                    </td>
                                    <td className="px-3 py-2 font-sans">
                                      <input
                                        type="text"
                                        placeholder={p.required ? "Required" : "Optional"}
                                        value={val}
                                        onChange={(e) => handleParamChange(op.id, p.name, e.target.value)}
                                        className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1 text-xs font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ophir-500"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Request Body (for POST / PUT / PATCH) */}
                    {["POST", "PUT", "PATCH"].includes(op.method) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                            Request Body (JSON)
                          </h4>
                          {op.requestBody?.required && (
                            <span className="text-xs text-rose-500 font-semibold">Required</span>
                          )}
                        </div>
                        {op.requestBody?.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{op.requestBody.description}</p>
                        )}
                        <textarea
                          rows={5}
                          value={opBody}
                          onChange={(e) => handleBodyChange(op.id, e.target.value)}
                          placeholder="{\n  // Enter JSON request payload\n}"
                          className="w-full font-mono text-xs bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl p-3 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ophir-500"
                        />
                      </div>
                    )}

                    {/* Responses Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Responses
                      </h4>
                      <div className="space-y-1.5 font-mono text-xs">
                        {Object.entries(op.responses).map(([code, resp]) => {
                          const is2xx = code.startsWith("2");
                          const is4xx = code.startsWith("4");
                          const is5xx = code.startsWith("5");
                          const badgeColor = is2xx
                            ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30"
                            : is4xx
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                            : is5xx
                            ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
                            : "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30";

                          return (
                            <div
                              key={code}
                              className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                            >
                              <span className={`px-2 py-0.5 rounded text-xs font-bold border ${badgeColor}`}>
                                {code}
                              </span>
                              <div className="font-sans text-xs text-gray-700 dark:text-gray-300 flex-1">
                                {resp.description || "Success or Error condition"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Try It Out & Live Curl Preview ────────────────────── */}
                    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                            <span>Execute Request (Live Test)</span>
                            <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-stellar/10 text-stellar font-mono">
                              {selectedServer}
                            </span>
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Sends an HTTP {op.method} request directly to the selected server.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => executeRequest(op)}
                            disabled={result?.loading}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-ophir-600 text-white hover:bg-ophir-700 disabled:opacity-50 transition shadow-sm"
                          >
                            {result?.loading && <Spinner className="w-3.5 h-3.5 animate-spin" />}
                            {result?.loading ? "Executing..." : "Send Request"}
                          </button>
                        </div>
                      </div>

                      {/* Generated curl command preview */}
                      <div className="relative group">
                        <div className="flex items-center justify-between text-[11px] text-gray-500 font-mono mb-1">
                          <span>curl preview:</span>
                          <CopyButton value={curlPreview} label="curl" />
                        </div>
                        <pre className="p-3 bg-gray-950 text-gray-200 rounded-lg text-xs font-mono overflow-x-auto border border-gray-800">
                          {curlPreview}
                        </pre>
                      </div>

                      {/* Execution Result Box */}
                      {result && !result.loading && (
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                                Response:
                              </span>
                              {result.status !== undefined && (
                                <Badge
                                  variant={
                                    result.status >= 200 && result.status < 300
                                      ? "success"
                                      : result.status >= 400 && result.status < 500
                                      ? "warning"
                                      : "danger"
                                  }
                                  className="font-mono text-xs font-bold"
                                >
                                  {result.status} {result.statusText}
                                </Badge>
                              )}
                              {result.durationMs !== undefined && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                  {result.durationMs} ms
                                </span>
                              )}
                            </div>
                            {result.body && <CopyButton value={result.body} label="Body" />}
                          </div>

                          {result.error && (
                            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs">
                              {result.error}
                            </div>
                          )}

                          {result.body && (
                            <pre className="p-3 bg-gray-950 text-emerald-400 dark:text-emerald-300 rounded-lg text-xs font-mono overflow-x-auto max-h-72 border border-gray-800">
                              {result.body}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
