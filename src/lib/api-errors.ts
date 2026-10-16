// SPDX-License-Identifier: MIT
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Standard RFC 7807 - Problem Details for HTTP APIs
 * https://datatracker.ietf.org/doc/html/rfc7807
 */
export interface ProblemDetailsOptions {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  invalidParams?: Array<{
    name: string;
    reason: string;
  }>;
}

export function formatProblemDetails(options: ProblemDetailsOptions): NextResponse {
  const payload = {
    type: options.type || `https://api.ophirpay.com/errors/${options.status}`,
    title: options.title,
    status: options.status,
    detail: options.detail,
    ...(options.instance ? { instance: options.instance } : {}),
    ...(options.invalidParams ? { invalidParams: options.invalidParams } : {}),
  };

  return new NextResponse(JSON.stringify(payload), {
    status: options.status,
    headers: {
      "Content-Type": "application/problem+json",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function formatZodProblemDetails(error: z.ZodError, instanceUrl?: string): NextResponse {
  const invalidParams = error.issues.map((issue) => ({
    name: issue.path.join("."),
    reason: issue.message,
  }));

  return formatProblemDetails({
    type: "https://api.ophirpay.com/errors/validation-failed",
    title: "Unprocessable Entity",
    status: 422,
    detail: "The payload submitted failed input validation constraints.",
    instance: instanceUrl,
    invalidParams,
  });
}
