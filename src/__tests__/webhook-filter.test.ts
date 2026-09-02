import { describe, it, expect } from "vitest";
import { isSubscribedToEvent } from "@/lib/webhook-filter";

describe("isSubscribedToEvent", () => {
  it("delivers to every event when the webhook has no filter (empty array)", () => {
    expect(isSubscribedToEvent("[]", "payment.created")).toBe(true);
    expect(isSubscribedToEvent("[]", "batch.failed")).toBe(true);
  });

  it("delivers only matching events when the webhook has a filter", () => {
    const stored = JSON.stringify(["payment.created", "payment.failed"]);
    expect(isSubscribedToEvent(stored, "payment.created")).toBe(true);
  });

  it("does not deliver non-matching events when filtered", () => {
    const stored = JSON.stringify(["payment.created"]);
    expect(isSubscribedToEvent(stored, "batch.failed")).toBe(false);
  });

  it("treats malformed JSON as no subscription", () => {
    expect(isSubscribedToEvent("not json", "payment.created")).toBe(false);
  });

  it("treats a non-array JSON value as no subscription", () => {
    expect(isSubscribedToEvent('{"foo":"bar"}', "payment.created")).toBe(false);
  });
});