// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import manifestFunction from "@/app/manifest";

describe("PWA Manifest & Static Assets (#788)", () => {
  const publicDir = path.resolve(process.cwd(), "public");
  const manifestJsonPath = path.join(publicDir, "manifest.json");

  it("reads and parses public/manifest.json successfully", () => {
    expect(fs.existsSync(manifestJsonPath)).toBe(true);
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    const json = JSON.parse(raw);
    expect(json.name).toBeTruthy();
    expect(json.short_name).toBeTruthy();
    expect(json.start_url).toBe("/");
    expect(json.display).toBe("standalone");
  });

  it("declares 192 and 512 PNG icons plus a maskable variant in public/manifest.json", () => {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    const json = JSON.parse(raw);

    const icons = json.icons as Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;

    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(4);

    const icon192 = icons.find(
      (i) => i.src === "/icon-192.png" && i.sizes === "192x192" && i.type === "image/png"
    );
    expect(icon192).toBeDefined();

    const icon512 = icons.find(
      (i) => i.src === "/icon-512.png" && i.sizes === "512x512" && i.type === "image/png"
    );
    expect(icon512).toBeDefined();

    const maskable192 = icons.find(
      (i) =>
        i.src === "/icon-maskable-192.png" &&
        i.sizes === "192x192" &&
        i.purpose?.includes("maskable")
    );
    expect(maskable192).toBeDefined();

    const maskable512 = icons.find(
      (i) =>
        i.src === "/icon-maskable-512.png" &&
        i.sizes === "512x512" &&
        i.purpose?.includes("maskable")
    );
    expect(maskable512).toBeDefined();
  });

  it("ensures every icon referenced in public/manifest.json exists on disk", () => {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    const json = JSON.parse(raw);

    for (const icon of json.icons) {
      const relPath = icon.src.startsWith("/") ? icon.src.slice(1) : icon.src;
      const filePath = path.join(publicDir, relPath);
      expect(fs.existsSync(filePath), `Icon file ${icon.src} must exist at ${filePath}`).toBe(
        true
      );
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("declares at least two screenshots with form_factor and label in public/manifest.json", () => {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    const json = JSON.parse(raw);

    const screenshots = json.screenshots as Array<{
      src: string;
      sizes: string;
      type: string;
      form_factor?: string;
      label?: string;
    }>;

    expect(Array.isArray(screenshots)).toBe(true);
    expect(screenshots.length).toBeGreaterThanOrEqual(2);

    for (const shot of screenshots) {
      expect(shot.src).toBeTruthy();
      expect(shot.sizes).toMatch(/^\d+x\d+$/);
      expect(shot.type).toBe("image/png");
      expect(shot.form_factor).toMatch(/^(wide|narrow)$/);
      expect(shot.label).toBeTruthy();

      const relPath = shot.src.startsWith("/") ? shot.src.slice(1) : shot.src;
      const filePath = path.join(publicDir, relPath);
      expect(
        fs.existsSync(filePath),
        `Screenshot file ${shot.src} must exist at ${filePath}`
      ).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("ensures shortcuts icons in public/manifest.json exist on disk", () => {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    const json = JSON.parse(raw);

    for (const shortcut of json.shortcuts || []) {
      expect(shortcut.name).toBeTruthy();
      expect(shortcut.url).toBeTruthy();
      for (const icon of shortcut.icons || []) {
        const relPath = icon.src.startsWith("/") ? icon.src.slice(1) : icon.src;
        const filePath = path.join(publicDir, relPath);
        expect(
          fs.existsSync(filePath),
          `Shortcut icon file ${icon.src} must exist at ${filePath}`
        ).toBe(true);
      }
    }
  });

  it("returns equivalent rich manifest from src/app/manifest.ts matching filesystem assets", () => {
    const manifest = manifestFunction();

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");

    // Icons check
    const icons = manifest.icons || [];
    expect(icons.length).toBeGreaterThanOrEqual(4);
    for (const icon of icons) {
      const relPath = icon.src.startsWith("/") ? icon.src.slice(1) : icon.src;
      const filePath = path.join(publicDir, relPath);
      expect(fs.existsSync(filePath), `Icon ${icon.src} must exist`).toBe(true);
    }

    // Screenshots check
    const screenshots = manifest.screenshots || [];
    expect(screenshots.length).toBeGreaterThanOrEqual(2);
    for (const shot of screenshots) {
      expect(shot.form_factor).toBeDefined();
      expect(shot.label).toBeDefined();
      const relPath = shot.src.startsWith("/") ? shot.src.slice(1) : shot.src;
      const filePath = path.join(publicDir, relPath);
      expect(fs.existsSync(filePath), `Screenshot ${shot.src} must exist`).toBe(true);
    }
  });
});
