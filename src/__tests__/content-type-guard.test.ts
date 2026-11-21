// SPDX-License-Identifier: MIT

import { describe, expect,it } from "vitest";

import {
  requireJsonContentType,
  unsupportedMediaTypeError,
} from "@/lib/api-response";

describe("unsupportedMediaTypeError", () => {
  it("returns 415 with UNSUPPORTED_MEDIA_TYPE code", async () => {
    const res = unsupportedMediaTypeError();
    expect(res.status).toBe(415);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(json.error.message).toBe("Content-Type must be application/json");
  });

  it("accepts a custom message", async () => {
    const res = unsupportedMediaTypeError("Expected JSON");
    const json = await res.json();
    expect(json.error.message).toBe("Expected JSON");
  });
});

describe("requireJsonContentType", () => {
  it("returns null for application/json", () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(requireJsonContentType(req)).toBeNull();
  });

  it("returns null for application/json with charset", () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: "{}",
    });
    expect(requireJsonContentType(req)).toBeNull();
  });

  it("handles case-insensitive Content-Type header values", () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "Application/JSON; Charset=UTF-8" },
      body: "{}",
    });
    expect(requireJsonContentType(req)).toBeNull();
  });

  it("returns 415 for text/plain", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    const res = requireJsonContentType(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(415);
  });

  it("returns 415 for multipart/form-data", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data" },
      body: "data",
    });
    const res = requireJsonContentType(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(415);
  });

  it("returns 415 when Content-Type header is missing", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: "{}",
    });
    const res = requireJsonContentType(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(415);
  });
});
