// SPDX-License-Identifier: MIT

/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import eslintConfig from "../../eslint.config.mjs";

describe("Suppression Guard & No-Explicit-Any Conformance (Issue #764)", () => {
  it("enforces @typescript-eslint/no-explicit-any and suppression-guard in eslint.config.mjs", () => {
    // Locate the config block with custom rules
    const configBlock = eslintConfig.find(
      (entry: unknown) =>
        entry &&
        typeof entry === "object" &&
        "rules" in entry &&
        Boolean((entry as { rules?: Record<string, unknown> }).rules?.["suppression-guard/require-description"])
    ) as { rules?: Record<string, unknown> } | undefined;

    expect(configBlock).toBeDefined();
    expect(configBlock?.rules?.["@typescript-eslint/no-explicit-any"]).toBe("error");
    expect(configBlock?.rules?.["suppression-guard/require-description"]).toBe("error");
  });

  it("verifies that all surviving eslint-disable directives in src/ have a justification", () => {
    function scanDir(dir: string, fileList: string[] = []): string[] {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
          scanDir(fullPath, fileList);
        } else if (/\.(ts|tsx)$/.test(file)) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const srcFiles = scanDir(join(process.cwd(), "src")).filter(
      (f) => !f.endsWith("suppression-guard.test.ts")
    );
    const unjustifiedSuppressions: string[] = [];

    for (const file of srcFiles) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("eslint-disable")) {
          // Directive must contain `-- <justification>`
          const parts = line.split("--");
          if (parts.length < 2 || parts[1].trim().length === 0) {
            unjustifiedSuppressions.push(
              `${file.replace(process.cwd(), "")}:${i + 1} -> ${line.trim()}`
            );
          }
        }
      }
    }

    expect(unjustifiedSuppressions).toEqual([]);
  });

  it("verifies that no explicit any remains in src/lib/ or src/app/ (production code)", () => {
    function scanDir(dir: string, fileList: string[] = []): string[] {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
          scanDir(fullPath, fileList);
        } else if (/\.(ts|tsx)$/.test(file) && !file.includes(".test.")) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const files = [
      ...scanDir(join(process.cwd(), "src", "lib")),
      ...scanDir(join(process.cwd(), "src", "app")),
    ];

    const anyMatches: string[] = [];
    const anyRegex = /(: any\b|\bas any\b)/;

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Ignore comments
        const codeOnly = line.split("//")[0];
        if (anyRegex.test(codeOnly)) {
          anyMatches.push(
            `${file.replace(process.cwd(), "")}:${i + 1} -> ${line.trim()}`
          );
        }
      }
    }

    expect(anyMatches).toEqual([]);
  });
});
