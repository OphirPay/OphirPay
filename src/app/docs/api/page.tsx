"use client";

// SPDX-License-Identifier: MIT
import React, { useEffect, useState } from "react";

interface EndpointDoc {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  parameters?: any[];
}

export default function ApiDocsPage() {
  const [spec, setSpec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/openapi.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch schema: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSpec(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400"></div>
        <span className="ml-3 font-mono text-sm text-slate-400">Loading OpenAPI documentation...</span>
      </div>
    );
  }

  if (error || !spec) {
    return (
      <div className="min-h-screen bg-slate-950 text-rose-400 p-8 flex flex-col items-center justify-center">
        <h1 className="text-xl font-bold mb-2">Error Loading API Documentation</h1>
        <p className="text-sm font-mono text-slate-400">{error || "Unknown error"}</p>
      </div>
    );
  }

  const endpoints: EndpointDoc[] = [];
  if (spec.paths) {
    Object.keys(spec.paths).forEach((p) => {
      const methods = spec.paths[p];
      Object.keys(methods).forEach((m) => {
        if (["get", "post", "put", "delete", "patch"].includes(m.toLowerCase())) {
          endpoints.push({
            path: p,
            method: m.toUpperCase(),
            summary: methods[m].summary,
            description: methods[m].description,
            parameters: methods[m].parameters,
          });
        }
      });
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-12 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="border-b border-slate-800 pb-8 mb-8">
          <div className="inline-block px-2.5 py-1 rounded bg-sky-500/10 text-sky-400 text-xs font-mono font-medium mb-3">
            OpenAPI {spec.openapi || "3.1.0"}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            {spec.info?.title || "OphirPay API Reference"}
          </h1>
          <p className="text-slate-400 text-sm max-w-2xl">
            {spec.info?.description?.slice(0, 200) || "Interactive developer reference for OphirPay Stellar payment APIs."}
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">REST Endpoints ({endpoints.length})</h2>
          {endpoints.map((ep, idx) => (
            <div key={idx} className="border border-slate-800 bg-slate-900/60 rounded-lg p-4 hover:border-slate-700 transition">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  ep.method === "GET"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : ep.method === "POST"
                    ? "bg-sky-500/10 text-sky-400"
                    : "bg-amber-500/10 text-amber-400"
                }`}>
                  {ep.method}
                </span>
                <span className="font-mono text-sm text-slate-200">{ep.path}</span>
                {ep.summary && <span className="text-xs text-slate-400 ml-auto hidden sm:inline">{ep.summary}</span>}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
