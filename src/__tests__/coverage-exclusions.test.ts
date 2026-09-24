import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("vitest.config.ts coverage exclusions integrity", () => {
  const configPath = join(process.cwd(), "vitest.config.ts");
  const rawConfig = readFileSync(configPath, "utf8");

  const excludeMatch = rawConfig.match(/coverage:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)\]/);

  it("defines an exclude array within the coverage configuration", () => {
    expect(excludeMatch).not.toBeNull();
  });

  const rawEntries = (excludeMatch?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"') || line.startsWith("'"))
    .map((line) => line.replace(/^["']/, "").replace(/["'],?$/, ""));

  it("contains no duplicate exclusion entries", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const entry of rawEntries) {
      if (seen.has(entry)) {
        duplicates.push(entry);
      }
      seen.add(entry);
    }

    expect(duplicates).toEqual([]);
  });

  it("does not contain stale or nonexistent file paths", () => {
    expect(rawEntries).not.toContain("src/lib/trustline-simulator.ts");
    expect(rawEntries).not.toContain("src/lib/instrumentation.ts");
  });

  it("includes corrected path for root instrumentation", () => {
    expect(rawEntries).toContain("src/instrumentation.ts");
    expect(existsSync(join(process.cwd(), "src/instrumentation.ts"))).toBe(true);
  });

  it("ensures every non-glob exclusion path exists on disk", () => {
    const missingPaths: string[] = [];

    for (const entry of rawEntries) {
      if (!entry.includes("*")) {
        const fullPath = join(process.cwd(), entry);
        if (!existsSync(fullPath)) {
          missingPaths.push(entry);
        }
      }
    }

    expect(missingPaths).toEqual([]);
  });

  it("ensures every directory-scoped glob exclusion corresponds to an existing directory", () => {
    const missingDirs: string[] = [];

    for (const entry of rawEntries) {
      if (entry.includes("/**")) {
        const dirPath = entry.replace(/\/\*\*.*$/, "");
        const fullDirPath = join(process.cwd(), dirPath);
        if (!existsSync(fullDirPath)) {
          missingDirs.push(entry);
        }
      }
    }

    expect(missingDirs).toEqual([]);
  });
});
