// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Offline Fallback Page & Service Worker Precache (#787)", () => {
  const publicDir = path.resolve(process.cwd(), "public");
  const offlineHtmlPath = path.join(publicDir, "offline.html");
  const swJsPath = path.join(publicDir, "sw.js");

  it("ensures public/offline.html exists and contains essential shell and banner elements", () => {
    expect(fs.existsSync(offlineHtmlPath)).toBe(true);
    const content = fs.readFileSync(offlineHtmlPath, "utf-8");

    // Must have DOCTYPE, title, and UTF-8 charset
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("<title>Offline — OphirPay</title>");
    expect(content).toContain('charset="UTF-8"');

    // Must include OphirPay branding
    expect(content).toContain("OphirPay");

    // Must include the offline banner with accessibility landmarks
    expect(content).toContain('role="status"');
    expect(content).toContain('aria-live="polite"');
    expect(content).toContain("You are offline — some features may be unavailable.");

    // Must include user action buttons
    expect(content).toContain("Retry Connection");
    expect(content).toContain("Go to Dashboard");

    // Must register reconnect listener
    expect(content).toContain('window.addEventListener("online"');
  });

  it("verifies public/sw.js declares cache versioning and precaches offline fallback", () => {
    expect(fs.existsSync(swJsPath)).toBe(true);
    const swContent = fs.readFileSync(swJsPath, "utf-8");

    // Cache versioning
    expect(swContent).toMatch(/const CACHE_VERSION = ["']ophirpay-v3["']/);
    expect(swContent).toContain("STATIC_CACHE");
    expect(swContent).toContain("DYNAMIC_CACHE");
    expect(swContent).toContain("API_CACHE");

    // Precache list includes offline fallback
    expect(swContent).toContain('const OFFLINE_FALLBACK_URL = "/offline.html"');
    expect(swContent).toContain("OFFLINE_FALLBACK_URL");
    expect(swContent).toContain('"/"');
    expect(swContent).toContain('"/manifest.json"');
  });

  it("verifies service worker activate listener purges stale caches on version bump", () => {
    const swContent = fs.readFileSync(swJsPath, "utf-8");

    // Activate event cleans up caches not matching current CACHE_VERSION
    expect(swContent).toContain('self.addEventListener("activate"');
    expect(swContent).toContain("!key.startsWith(CACHE_VERSION)");
    expect(swContent).toContain("caches.delete(key)");
  });

  it("verifies navigation fetch strategy falls back to precached offline shell", () => {
    const swContent = fs.readFileSync(swJsPath, "utf-8");

    expect(swContent).toContain('request.mode === "navigate"');
    expect(swContent).toContain("caches.match(OFFLINE_FALLBACK_URL)");
  });

  it("ensures all precached files in public/sw.js exist on the filesystem", () => {
    const swContent = fs.readFileSync(swJsPath, "utf-8");
    const precacheMatches = swContent.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
    expect(precacheMatches).not.toBeNull();

    // /offline.html must exist
    expect(fs.existsSync(path.join(publicDir, "offline.html"))).toBe(true);
    // /manifest.json must exist
    expect(fs.existsSync(path.join(publicDir, "manifest.json"))).toBe(true);
    // /icon.svg must exist
    expect(fs.existsSync(path.join(publicDir, "icon.svg"))).toBe(true);
  });
});
