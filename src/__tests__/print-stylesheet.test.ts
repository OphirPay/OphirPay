// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Print Stylesheet in globals.css", () => {
  const cssPath = path.resolve(__dirname, "../app/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  it("defines .print-only hidden by default", () => {
    expect(cssContent).toMatch(/\.print-only\s*\{\s*display:\s*none\s*!important/);
  });

  it("contains @media print block", () => {
    expect(cssContent).toContain("@media print");
  });

  it("hides navigation, sidebar, header, action buttons, and .no-print elements in print", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toContain(".no-print");
    expect(printCss).toContain("sidebar");
    expect(printCss).toContain("header");
    expect(printCss).toContain("button");
    expect(printCss).toContain("display: none !important");
  });

  it("displays .print-only elements during print", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toMatch(/\.print-only\s*\{\s*display:\s*block\s*!important/);
  });

  it("resets sidebar margin offset (.lg\\:ml-64) so content uses full print width", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toContain("margin-left: 0 !important");
    expect(printCss).toContain("width: 100% !important");
  });

  it("enforces print-safe background and text colors across light and dark themes", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toContain("#ffffff !important");
    expect(printCss).toContain("#111827 !important");
    expect(printCss).toContain("-webkit-print-color-adjust: exact !important");
  });

  it("configures page-break avoidance for critical blocks and cards", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toContain("page-break-inside: avoid !important");
    expect(printCss).toContain("break-inside: avoid !important");
  });

  it("configures overflow wrapping for long hashes and addresses", () => {
    const printBlockMatch = cssContent.match(/@media print\s*\{([\s\S]*)\}/);
    expect(printBlockMatch).toBeTruthy();
    const printCss = printBlockMatch![1];

    expect(printCss).toContain("word-break: break-all !important");
    expect(printCss).toContain("overflow-wrap: anywhere !important");
  });
});
