// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/openapi.json/route";
import {
  getOpenApiSpec,
  STELLAR_TESTNET_ENV,
  extractOpenApiOperations,
  buildRequestUrl,
  buildCurlSnippet,
} from "@/lib/openapi";
import ApiDocsPage, { OpenApiReferenceView } from "@/app/docs/api/page";

describe("GET /api/openapi.json route", () => {
  it("returns 200 with valid OpenAPI 3.1 JSON parsed from docs/openapi.yaml", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("max-age=60");

    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info?.title).toBe("OphirPay API");
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThanOrEqual(40);
    expect(spec.paths["/api/payments"]).toBeDefined();
    expect(spec.paths["/api/batches"]).toBeDefined();
    expect(spec.paths["/api/escrows"]).toBeDefined();
    expect(spec.paths["/api/openapi.json"]).toBeDefined();
    expect(spec.components?.schemas?.CreatePaymentRequest).toBeDefined();
    expect(spec.components?.schemas?.PaymentResponse).toBeDefined();
  });

  it("includes Stellar Testnet environment metadata for Try it out", async () => {
    const req = new Request("http://localhost:3000/api/openapi.json");
    const res = await GET(req);
    const spec = await res.json();

    expect(spec["x-stellar-environment"]).toEqual(STELLAR_TESTNET_ENV);
    expect(
      spec.servers?.some((s: { description?: string }) =>
        s.description?.toLowerCase().includes("testnet")
      )
    ).toBe(true);
  });
});

describe("OpenAPI schema & URL helpers", () => {
  it("extracts all 40+ paths and resolves $ref request/response schemas", () => {
    const spec = getOpenApiSpec(true);
    const ops = extractOpenApiOperations(spec);

    expect(ops.length).toBeGreaterThanOrEqual(40);
    const createPaymentOp = ops.find(
      (op) => op.method === "POST" && op.path === "/api/payments"
    );
    expect(createPaymentOp).toBeDefined();
    expect(createPaymentOp?.resolvedRequestSchema?.properties?.amount).toBeDefined();
    expect(createPaymentOp?.resolvedRequestSchema?.properties?.destAddress).toBeDefined();
    expect(createPaymentOp?.responses["201"]).toBeDefined();
  });

  it("builds Stellar Testnet target URLs and curl commands", () => {
    const url = buildRequestUrl(
      "https://testnet.api.ophirpay.com",
      "/api/payments/{id}",
      { id: "pay_123" },
      { includeEvents: "true" }
    );
    expect(url).toBe("https://testnet.api.ophirpay.com/api/payments/pay_123?includeEvents=true");

    const curl = buildCurlSnippet({
      method: "POST",
      url: "https://testnet.api.ophirpay.com/api/payments",
      apiKey: "oph_test_key_999",
      requiresAuth: true,
      body: '{"amount":100}',
    });
    expect(curl).toContain('curl -X POST "https://testnet.api.ophirpay.com/api/payments"');
    expect(curl).toContain("X-Stellar-Network: testnet");
    expect(curl).toContain("Authorization: Bearer oph_test_key_999");
    expect(curl).toContain('{"amount":100}');
  });
});

describe("/docs/api interactive OpenAPI reference page", () => {
  const realSpec = getOpenApiSpec();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/openapi.json")) {
          return new Response(JSON.stringify(realSpec), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: "pay_testnet_01", status: "CREATED" },
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }
        );
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches /api/openapi.json on mount and renders all 40+ endpoints without CSP violations", async () => {
    const { container } = render(<ApiDocsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("openapi-endpoints-list")).toBeInTheDocument();
    });

    // Verify no inline <script> tags are injected (strict CSP compliance)
    expect(container.querySelectorAll("script").length).toBe(0);

    // Verify Stellar Testnet environment details are displayed
    expect(screen.getByText(/Stellar Testnet Ready/i)).toBeInTheDocument();
    expect(screen.getByText(STELLAR_TESTNET_ENV.networkPassphrase)).toBeInTheDocument();
    expect(screen.getByText(STELLAR_TESTNET_ENV.horizonUrl)).toBeInTheDocument();
    expect(screen.getByText(STELLAR_TESTNET_ENV.sorobanRpcUrl)).toBeInTheDocument();

    // Verify 40+ endpoint cards are rendered
    const endpointCards = container.querySelectorAll('[data-testid^="endpoint-card-"]');
    expect(endpointCards.length).toBeGreaterThanOrEqual(40);
  });

  it("renders request schemas, responses, and executes Try it out against Stellar Testnet", async () => {
    render(<OpenApiReferenceView initialSpec={realSpec} />);

    // Filter to /api/payments POST
    const searchInput = screen.getByLabelText("Search API endpoints");
    fireEvent.change(searchInput, { target: { value: "/api/payments" } });
    fireEvent.click(screen.getByRole("button", { name: "POST" }));

    const paymentCard = screen.getByTestId("endpoint-card-POST-/api/payments");
    expect(paymentCard).toBeInTheDocument();

    // Open Try it out for POST /api/payments
    const tryButtons = screen.getAllByRole("button", { name: "Try it out" });
    fireEvent.click(tryButtons[0]);

    // Request schema & response status codes should be visible
    expect(
      screen.getByText(/Request Body Schema \(application\/json\)/i)
    ).toBeInTheDocument();
    expect(screen.getByText("destAddress")).toBeInTheDocument();
    expect(screen.getByText("sourceAccountId")).toBeInTheDocument();
    expect(screen.getByText("201")).toBeInTheDocument();

    // Provide an API key and execute the Try it out request
    const apiKeyInput = screen.getByLabelText(/API Key \/ Bearer Token/i);
    fireEvent.change(apiKeyInput, { target: { value: "oph_testnet_demo_key" } });

    const executeBtn = screen.getByRole("button", {
      name: "Execute POST /api/payments",
    });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(
        screen.getByTestId("try-it-out-result-POST /api/payments")
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/pay_testnet_01/)).toBeInTheDocument();
  });

  it("displays resolved component schemas when switching to the Schemas tab", () => {
    render(<OpenApiReferenceView initialSpec={realSpec} />);

    const schemasTabBtn = screen.getByRole("button", { name: /Schemas \(/i });
    fireEvent.click(schemasTabBtn);

    expect(screen.getByTestId("openapi-schemas-list")).toBeInTheDocument();
    expect(screen.getByText("PaymentResponse")).toBeInTheDocument();
    expect(screen.getByText("CreatePaymentRequest")).toBeInTheDocument();
    expect(screen.getByText("CreateBatchRequest")).toBeInTheDocument();
  });

  it("documents /docs/api and /api/openapi.json in docs/API_GUIDE.md", () => {
    const guide = readFileSync(path.join(process.cwd(), "docs/API_GUIDE.md"), "utf8");
    expect(guide).toContain("/docs/api");
    expect(guide).toContain("/api/openapi.json");
  });
});
