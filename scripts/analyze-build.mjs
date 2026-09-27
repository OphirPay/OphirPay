#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Opt-in bundle analysis (issue #739).
//
// The interactive treemap from @next/bundle-analyzer is webpack-only, so this
// runs a webpack production build with ANALYZE=true. The report is written to
// `.next/analyze/*.html` (client + server + edge). Normal `npm run build`
// (Turbopack) and CI are untouched; CI enforces the committed budget with
// `npm run bundle:check` instead.

import { spawnSync } from "node:child_process";

const result = spawnSync("next build --webpack", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ANALYZE: "true" },
});

if (result.error) {
  console.error("Failed to run the analyzer build:", result.error.message);
  process.exit(1);
}

console.log(
  "\nBundle analysis written to .next/analyze/ — open the .html reports in a browser."
);
process.exit(result.status ?? 1);
