// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { getOpenApiSpec } from "@/lib/openapi";
import { ApiDocsBrowser } from "@/components/docs/ApiDocsBrowser";

export const metadata: Metadata = {
  title: "API Documentation & Interactive Reference | OphirPay",
  description:
    "Interactive OpenAPI 3.1 documentation and Stellar Testnet development reference for OphirPay payment infrastructure APIs.",
};

export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  const spec = getOpenApiSpec();
  return <ApiDocsBrowser initialSpec={spec} />;
}
