// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatRelativeTime, relativeTimeProps } from "@/lib/date-utils";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("formatRelativeTime", () => {
  it("formats 30 seconds ago as 'Just now'", () => {
    expect(formatRelativeTime(ago(30), NOW)).toBe("Just now");
  });

  it("formats the current instant as 'Just now'", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("Just now");
  });

  it("treats future timestamps as 'Just now'", () => {
    expect(formatRelativeTime(ago(-300), NOW)).toBe("Just now");
  });

  it("formats 1 minute ago in the singular", () => {
    expect(formatRelativeTime(ago(60), NOW)).toBe("1 minute ago");
  });

  it("formats 2 minutes ago", () => {
    expect(formatRelativeTime(ago(2 * 60), NOW)).toBe("2 minutes ago");
  });

  it("formats 1 hour ago in the singular", () => {
    expect(formatRelativeTime(ago(3600), NOW)).toBe("1 hour ago");
  });

  it("formats 2 hours ago", () => {
    expect(formatRelativeTime(ago(2 * 3600), NOW)).toBe("2 hours ago");
  });

  it("formats 25 hours ago as 'Yesterday'", () => {
    expect(formatRelativeTime(ago(25 * 3600), NOW)).toBe("Yesterday");
  });

  it("formats several days ago", () => {
    expect(formatRelativeTime(ago(3 * 86400), NOW)).toBe("3 days ago");
  });

  it("falls back to an ISO date after 30 days", () => {
    expect(formatRelativeTime(ago(40 * 86400), NOW)).toBe("2026-05-06");
  });

  it("switches units exactly at the boundaries", () => {
    expect(formatRelativeTime(ago(59), NOW)).toBe("Just now");
    expect(formatRelativeTime(ago(60), NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(ago(3599), NOW)).toBe("59 minutes ago");
    expect(formatRelativeTime(ago(3600), NOW)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(86399), NOW)).toBe("23 hours ago");
    expect(formatRelativeTime(ago(86400), NOW)).toBe("Yesterday");
  });

  it("accepts ISO strings and millisecond timestamps", () => {
    const then = ago(2 * 3600);
    expect(formatRelativeTime(then.toISOString(), NOW)).toBe("2 hours ago");
    expect(formatRelativeTime(then.getTime(), NOW)).toBe("2 hours ago");
  });
});

describe("relativeTimeProps", () => {
  it("returns the label and the exact ISO string", () => {
    const then = ago(2 * 3600);
    expect(relativeTimeProps(then, NOW)).toEqual({
      label: "2 hours ago",
      title: "2026-06-15T10:00:00.000Z",
    });
  });

  it("normalises string inputs to a full ISO string", () => {
    expect(relativeTimeProps("2026-06-15T11:58:00Z", NOW).title).toBe(
      "2026-06-15T11:58:00.000Z"
    );
  });

  it("places the ISO string in the title attribute of a rendered <time>", () => {
    const { label, title } = relativeTimeProps(ago(2 * 3600), NOW);
    const html = renderToStaticMarkup(
      createElement("time", { dateTime: title, title }, label)
    );
    expect(html).toContain('title="2026-06-15T10:00:00.000Z"');
    expect(html).toContain(">2 hours ago</time>");
  });
});
