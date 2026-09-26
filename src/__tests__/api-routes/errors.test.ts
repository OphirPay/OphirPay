// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET, DELETE } from "@/app/api/errors/route";
import { clearStoredErrorReports, getStoredErrorReports } from "@/lib/sentry";

describe("API Route: /api/errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredErrorReports();
  });

  it("POST ingests an error report, scrubs PII, and returns 201", async () => {
    const PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    const req = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      body: JSON.stringify({
        name: "NetworkError",
        message: `Failed RPC request for account ${PUBLIC_KEY} with 50.00 XLM`,
        component: "SendForm",
        segment: "/send",
        release: "0.1.0",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.fingerprint).toBeDefined();
    expect(json.data.count).toBe(1);
    expect(json.data.message).not.toContain(PUBLIC_KEY);
    expect(json.data.message).toContain("[REDACTED_ADDRESS]");
    expect(json.data.message).toContain("[REDACTED_AMOUNT]");
  });

  it("POST deduplicates repeated error reports and returns 200", async () => {
    const createReq = () =>
      new NextRequest("http://localhost/api/errors", {
        method: "POST",
        body: JSON.stringify({
          name: "TimeoutError",
          message: "Gateway timeout",
          component: "BridgePage",
          release: "0.1.0",
        }),
      });

    const res1 = await POST(createReq());
    expect(res1.status).toBe(201);

    const res2 = await POST(createReq());
    expect(res2.status).toBe(200);

    const json2 = await res2.json();
    expect(json2.data.count).toBe(2);

    const stored = getStoredErrorReports({ component: "BridgePage" });
    expect(stored.length).toBe(1);
    expect(stored[0].count).toBe(2);
  });

  it("POST returns 400 when message is missing", async () => {
    const req = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      body: JSON.stringify({
        name: "MissingMessage",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("GET queries and filters error reports", async () => {
    const req1 = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      body: JSON.stringify({
        name: "ErrorA",
        message: "Message A",
        component: "ComponentA",
        release: "1.0.0",
      }),
    });
    const req2 = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      body: JSON.stringify({
        name: "ErrorB",
        message: "Message B",
        component: "ComponentB",
        release: "2.0.0",
      }),
    });

    await POST(req1);
    await POST(req2);

    // Query all
    const getResAll = await GET(new NextRequest("http://localhost/api/errors"));
    const jsonAll = await getResAll.json();
    expect(jsonAll.data.total).toBe(2);

    // Filter by release
    const getResRel = await GET(new NextRequest("http://localhost/api/errors?release=1.0.0"));
    const jsonRel = await getResRel.json();
    expect(jsonRel.data.total).toBe(1);
    expect(jsonRel.data.reports[0].component).toBe("ComponentA");
  });

  it("DELETE clears all stored error reports", async () => {
    const postReq = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      body: JSON.stringify({
        message: "Temporary error",
      }),
    });
    await POST(postReq);
    expect(getStoredErrorReports().length).toBe(1);

    const delRes = await DELETE();
    expect(delRes.status).toBe(200);
    expect(getStoredErrorReports().length).toBe(0);
  });
});
