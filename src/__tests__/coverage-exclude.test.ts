// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import vitestConfig from "../../vitest.config";

describe("Vitest coverage exclude configuration", () => {
  const excludeList = vitestConfig.test?.coverage?.exclude || [];

  it("should not contain duplicate entries", () => {
    const duplicates = excludeList.filter(
      (item, index) => excludeList.indexOf(item) !== index
    );
    expect(duplicates).toEqual([]);
  });

  it("should ensure every excluded path exists on disk", () => {
    const projectRoot = path.resolve(__dirname, "../..");

    for (const pattern of excludeList) {
      if (pattern.includes("*")) {
        if (pattern === "**/*.d.ts") {
          expect(fs.existsSync(path.join(projectRoot, "src"))).toBe(true);
          continue;
        }
        const baseDir = pattern.split("/*")[0].replace(/^\*\*\//, "");
        const absolutePath = path.join(projectRoot, baseDir);
        expect(
          fs.existsSync(absolutePath),
          `Glob base directory "${baseDir}" (from pattern "${pattern}") does not exist`
        ).toBe(true);
      } else {
        const absolutePath = path.join(projectRoot, pattern);
        expect(
          fs.existsSync(absolutePath),
          `Excluded path "${pattern}" does not exist on disk`
        ).toBe(true);
      }
    }
  });
});
