// SPDX-License-Identifier: MIT
"use client";

import React, { useState, useMemo } from "react";
import {
  type OpenApiDocument,
  extractOpenApiOperations,
  buildRequestUrl,
  buildCurlSnippet,
  STELLAR_TESTNET_ENV,
} from "@/lib/openapi-schema";

interface ApiDocsBrowserProps {
  initialSpec: OpenApiDocument;
}

export function ApiDocsBrowser({ initialSpec }: ApiDocsBrowserProps) {
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("All");
  const [activeOpId, setActiveOpId] = useState<string | null>(null);

  // Try it out state
  const [selectedServer, setSelectedServer] = useState<string>(
    initialSpec.servers?.[0]?.url || STELLAR_TESTNET_ENV.defaultServerUrl
  );
  const [apiKey, setApiKey] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({});
  const [bodyValues, setBodyValues] = useState<Record<string, string>>({});
  const [executionResult, setExecutionResult] = useState<{
    opId: string;
    loading: boolean;
    status?: number;
    durationMs?: number;
    responseBody?: string;
    error?: string;
  } | null>(null);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  const operations = useMemo(() => {
    return extractOpenApiOperations(initialSpec);
  }, [initialSpec]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const op of operations) {
      for (const t of op.tags) set.add(t);
    }
    return ["All", ...Array.from(set).sort()];
  }, [operations]);

  const filteredOps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return operations.filter((op) => {
      const matchTag = selectedTag === "All" || op.tags.includes(selectedTag);
      const matchQuery =
        !q ||
        op.path.toLowerCase().includes(q) ||
        op.summary.toLowerCase().includes(q) ||
        op.method.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q);
      return matchTag && matchQuery;
    });
  }, [operations, search, selectedTag]);

  const activeOp = useMemo(() => {
    if (!activeOpId) return operations[0] || null;
    return operations.find((o) => o.id === activeOpId) || operations[0] || null;
  }, [operations, activeOpId]);

  const handleParamChange = (opId: string, paramName: string, val: string) => {
    setParamValues((prev) => ({
      ...prev,
      [opId]: {
        ...(prev[opId] || {}),
        [paramName]: val,
      },
    }));
  };

  const currentOpParams = useMemo(() => {
    return (activeOp ? paramValues[activeOp.id] : undefined) || {};
  }, [activeOp, paramValues]);
  const currentOpBody = activeOp
    ? bodyValues[activeOp.id] ?? (activeOp.sampleRequestBody || "")
    : "";

  const resolvedUrl = useMemo(() => {
    if (!activeOp) return "";
    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    for (const p of activeOp.parameters) {
      const val = currentOpParams[p.name] ?? (p.example ? String(p.example) : "");
      if (p.in === "path") pathParams[p.name] = val;
      if (p.in === "query") queryParams[p.name] = val;
    }
    return buildRequestUrl(selectedServer, activeOp.path, pathParams, queryParams);
  }, [activeOp, selectedServer, currentOpParams]);

  const curlSnippet = useMemo(() => {
    if (!activeOp) return "";
    return buildCurlSnippet({
      method: activeOp.method,
      url: resolvedUrl,
      apiKey,
      requiresAuth: activeOp.requiresAuth,
      body: currentOpBody,
    });
  }, [activeOp, resolvedUrl, apiKey, currentOpBody]);

  const handleCopyCurl = () => {
    if (!curlSnippet) return;
    navigator.clipboard.writeText(curlSnippet).then(() => {
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    });
  };

  const handleExecute = async () => {
    if (!activeOp) return;
    setExecutionResult({ opId: activeOp.id, loading: true });
    const start = performance.now();

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Stellar-Network": STELLAR_TESTNET_ENV.network,
      };
      if (apiKey.trim()) {
        headers["Authorization"] = `Bearer ${apiKey.trim()}`;
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(activeOp.method) && currentOpBody.trim()) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(resolvedUrl, {
        method: activeOp.method,
        headers,
        body:
          ["POST", "PUT", "PATCH", "DELETE"].includes(activeOp.method) && currentOpBody.trim()
            ? currentOpBody
            : undefined,
      });

      const end = performance.now();
      const text = await res.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep text as-is if not JSON
      }

      setExecutionResult({
        opId: activeOp.id,
        loading: false,
        status: res.status,
        durationMs: Math.round(end - start),
        responseBody: formatted,
      });
    } catch (err) {
      const end = performance.now();
      setExecutionResult({
        opId: activeOp.id,
        loading: false,
        status: 0,
        durationMs: Math.round(end - start),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const methodBadgeClass = (method: string) => {
    switch (method) {
      case "GET":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
      case "POST":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "PUT":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "DELETE":
        return "bg-rose-500/10 text-rose-500 border-rose-500/20";
      case "PATCH":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Banner */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            OP
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              {initialSpec.info.title}
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 font-mono text-slate-400">
                v{initialSpec.info.version}
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Interactive OpenAPI 3.1 Documentation & Stellar Testnet Sandbox
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-300 font-medium">Stellar Testnet: Active</span>
          </div>
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 font-medium transition"
          >
            Raw openapi.json
          </a>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Endpoints Navigation */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/30 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-800 space-y-3">
            <input
              type="text"
              placeholder="Search endpoints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`text-[11px] px-2.5 py-1 rounded-full shrink-0 transition ${
                    selectedTag === tag
                      ? "bg-indigo-600 text-white font-semibold"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="text-[11px] font-semibold text-slate-500 uppercase px-3 py-1 tracking-wider">
              Endpoints ({filteredOps.length})
            </div>
            {filteredOps.map((op) => {
              const isActive = activeOp?.id === op.id;
              return (
                <button
                  key={op.id}
                  onClick={() => setActiveOpId(op.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 transition text-xs ${
                    isActive
                      ? "bg-indigo-600/15 border border-indigo-500/30 text-white"
                      : "hover:bg-slate-800/50 text-slate-300"
                  }`}
                >
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${methodBadgeClass(
                      op.method
                    )}`}
                  >
                    {op.method}
                  </span>
                  <span className="truncate flex-1 font-mono text-[11px]">{op.path}</span>
                  {op.requiresAuth && (
                    <span className="text-[10px] text-amber-400" title="Requires Authentication">
                      🔒
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Pane: Endpoint Details & Interactive Console */}
        <main className="flex-1 overflow-y-auto p-8 space-y-8 max-w-5xl">
          {activeOp ? (
            <div className="space-y-6">
              {/* Endpoint Header */}
              <div className="space-y-3 pb-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <span
                    className={`font-mono text-xs font-bold px-2 py-1 rounded border ${methodBadgeClass(
                      activeOp.method
                    )}`}
                  >
                    {activeOp.method}
                  </span>
                  <span className="font-mono text-base font-semibold text-slate-100">
                    {activeOp.path}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white">{activeOp.summary}</h2>
                {activeOp.description && (
                  <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">
                    {activeOp.description}
                  </p>
                )}
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-slate-500">Tags:</span>
                  {activeOp.tags.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {t}
                    </span>
                  ))}
                  {activeOp.requiresAuth ? (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                      Bearer / API Key Required
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      Public / No Auth Required
                    </span>
                  )}
                </div>
              </div>

              {/* Try it Out Panel */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
                <div className="bg-slate-800/50 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                    Interactive Console (Stellar Testnet)
                  </h3>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedServer}
                      onChange={(e) => setSelectedServer(e.target.value)}
                      className="bg-slate-950 border border-slate-700 text-xs rounded px-2.5 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {initialSpec.servers?.map((s) => (
                        <option key={s.url} value={s.url}>
                          {s.description || s.url}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Auth Input if required */}
                  {activeOp.requiresAuth && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                        <span>API Key / Bearer Token</span>
                        <span className="text-[11px] text-slate-500 font-normal">
                          Configured for Stellar Testnet
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="op_live_... or test token"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  )}

                  {/* Parameters */}
                  {activeOp.parameters.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Parameters ({activeOp.parameters.length})
                      </h4>
                      <div className="space-y-2">
                        {activeOp.parameters.map((param) => {
                          const val = currentOpParams[param.name] ?? "";
                          return (
                            <div
                              key={`${param.in}-${param.name}`}
                              className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center text-xs p-2 rounded bg-slate-950/50 border border-slate-800/80"
                            >
                              <div className="font-mono text-slate-300 flex items-center gap-1.5">
                                <span className="font-bold">{param.name}</span>
                                <span className="text-[10px] text-slate-500">({param.in})</span>
                                {param.required && (
                                  <span className="text-rose-400 text-[10px] font-bold">*</span>
                                )}
                              </div>
                              <div className="text-slate-400 text-[11px] truncate">
                                {param.description || (param.schema?.type ? `Type: ${param.schema.type}` : "")}
                              </div>
                              <div>
                                <input
                                  type="text"
                                  placeholder={param.example ? String(param.example) : "value"}
                                  value={val}
                                  onChange={(e) =>
                                    handleParamChange(activeOp.id, param.name, e.target.value)
                                  }
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Request Body */}
                  {["POST", "PUT", "PATCH"].includes(activeOp.method) && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          Request Body (JSON)
                        </h4>
                        {activeOp.sampleRequestBody && (
                          <button
                            onClick={() =>
                              setBodyValues((prev) => ({
                                ...prev,
                                [activeOp.id]: activeOp.sampleRequestBody || "",
                              }))
                            }
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                          >
                            Reset to sample
                          </button>
                        )}
                      </div>
                      <textarea
                        rows={6}
                        value={currentOpBody}
                        onChange={(e) =>
                          setBodyValues((prev) => ({
                            ...prev,
                            [activeOp.id]: e.target.value,
                          }))
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  )}

                  {/* Generated cURL & Execute Controls */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-400">cURL Command</span>
                      <button
                        onClick={handleCopyCurl}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
                      >
                        {copiedCurl ? "✓ Copied" : "Copy cURL"}
                      </button>
                    </div>
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto">
                      {curlSnippet}
                    </pre>
                  </div>

                  <div className="pt-2 flex items-center justify-end">
                    <button
                      onClick={handleExecute}
                      disabled={executionResult?.loading}
                      className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
                    >
                      {executionResult?.loading ? "Executing..." : "Send Request"}
                    </button>
                  </div>

                  {/* Execution Response */}
                  {executionResult && executionResult.opId === activeOp.id && (
                    <div className="space-y-2 pt-3 border-t border-slate-800">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-300">Live Server Response</span>
                        <div className="flex items-center gap-3">
                          {executionResult.status !== undefined && (
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                                executionResult.status >= 200 && executionResult.status < 300
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : "bg-rose-500/20 text-rose-400"
                              }`}
                            >
                              Status: {executionResult.status}
                            </span>
                          )}
                          {executionResult.durationMs !== undefined && (
                            <span className="text-slate-400 font-mono text-[11px]">
                              {executionResult.durationMs}ms
                            </span>
                          )}
                        </div>
                      </div>
                      {executionResult.error ? (
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-mono">
                          {executionResult.error}
                        </div>
                      ) : (
                        <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-80">
                          {executionResult.responseBody}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Response Specifications */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                  Responses & Schemas
                </h3>
                <div className="space-y-3">
                  {Object.entries(activeOp.responses).map(([status, resp]) => (
                    <div
                      key={status}
                      className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                            status.startsWith("2")
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {status}
                        </span>
                        <span className="text-xs text-slate-300 font-medium">{resp.description}</span>
                      </div>
                      {resp.example !== undefined && (
                        <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] font-mono text-slate-300 overflow-x-auto">
                          {typeof resp.example === "string"
                            ? resp.example
                            : JSON.stringify(resp.example, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 text-sm">
              Select an endpoint to view documentation and test live requests.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
