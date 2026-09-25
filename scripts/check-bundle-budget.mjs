#!/usr/bin/env node

// SPDX-License-Identifier: MIT
// Bundle size budget evaluator for OphirPay Next.js client bundles.
// Compares route first-load JS (gzip) against committed budgets in bundle-budget.json.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

/**
 * Normalizes Next.js App Router internal page keys into clean route paths.
 * Examples:
 *   "/(dashboard)/page" -> "/"
 *   "/page" -> "/"
 *   "/analytics/page" -> "/analytics"
 *   "/batches/[id]/page" -> "/batches/[id]"
 */
export function normalizeRoute(pageKey) {
  let route = pageKey;
  if (route.endsWith('/page')) {
    route = route.slice(0, -5);
  }
  // Strip route group parens like /(dashboard) -> ""
  route = route.replace(/\/\([^)]+\)/g, '');
  if (!route || route === '') {
    route = '/';
  }
  return route;
}

/**
 * Reads chunk files and computes raw + gzip sizes.
 */
export function getChunkSizes(nextDir, chunkPaths) {
  const chunks = [];
  let totalRawBytes = 0;
  let totalGzipBytes = 0;

  const uniquePaths = Array.from(new Set(chunkPaths));

  for (const relPath of uniquePaths) {
    const fullPath = path.join(nextDir, relPath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const content = fs.readFileSync(fullPath);
    const rawBytes = content.length;
    const gzipBytes = zlib.gzipSync(content).length;

    totalRawBytes += rawBytes;
    totalGzipBytes += gzipBytes;

    chunks.push({
      path: relPath,
      name: path.basename(relPath),
      rawBytes,
      gzipBytes,
      gzipKb: Number((gzipBytes / 1024).toFixed(1)),
    });
  }

  // Sort chunks by gzip size descending
  chunks.sort((a, b) => b.gzipBytes - a.gzipBytes);

  return {
    chunks,
    totalRawBytes,
    totalGzipBytes,
    totalRawKb: Number((totalRawBytes / 1024).toFixed(1)),
    totalGzipKb: Number((totalGzipBytes / 1024).toFixed(1)),
  };
}

/**
 * Computes First Load JS size for all routes from Next.js manifests.
 * Handles both Next.js App Router RSC client manifests and legacy app-build-manifest.
 */
export function computeRouteSizes(nextDir) {
  const buildManifestPath = path.join(nextDir, 'build-manifest.json');
  const appRoutesManifestPath = path.join(nextDir, 'app-path-routes-manifest.json');
  const appBuildManifestPath = path.join(nextDir, 'app-build-manifest.json');

  if (!fs.existsSync(buildManifestPath)) {
    throw new Error(
      `Next.js build directory or manifest not found in "${nextDir}". Please run "npm run build" or "npm run analyze" first.`
    );
  }

  // Collect root shared chunks (loaded on every page)
  let sharedChunks = [];
  try {
    const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
    if (Array.isArray(buildManifest.rootMainFiles)) {
      sharedChunks = buildManifest.rootMainFiles;
    }
  } catch {
    // Ignore parse error
  }

  const routeMap = new Map();

  // Pattern 1: App Router via app-path-routes-manifest and client reference manifests
  if (fs.existsSync(appRoutesManifestPath)) {
    try {
      const appRoutes = JSON.parse(fs.readFileSync(appRoutesManifestPath, 'utf8'));
      for (const [pageKey, routeUrl] of Object.entries(appRoutes)) {
        if (!pageKey.endsWith('/page')) continue;

        const relPath = pageKey.replace(/^\//, '').replace(/\/page$/, '');
        const manifestJsPath = path.join(nextDir, 'server/app', relPath, 'page_client-reference-manifest.js');

        const chunks = new Set(sharedChunks);

        if (fs.existsSync(manifestJsPath)) {
          const sandbox = { globalThis: {} };
          vm.createContext(sandbox);
          try {
            vm.runInContext(fs.readFileSync(manifestJsPath, 'utf8'), sandbox);
            const rsc = sandbox.globalThis.__RSC_MANIFEST?.[pageKey];
            if (rsc?.clientModules) {
              for (const [, data] of Object.entries(rsc.clientModules)) {
                if (Array.isArray(data.chunks)) {
                  for (const c of data.chunks) {
                    if (typeof c === 'string' && c.endsWith('.js')) {
                      chunks.add(c);
                    }
                  }
                }
              }
            }
          } catch {
            // Ignore execution error, fallback to shared chunks
          }
        }

        const stats = getChunkSizes(nextDir, Array.from(chunks));
        const normalized = routeUrl || normalizeRoute(pageKey);
        routeMap.set(normalized, {
          route: normalized,
          pageKey,
          ...stats,
        });
      }
    } catch {
      // Fall through to other manifest formats
    }
  }

  // Pattern 2: app-build-manifest.json
  if (routeMap.size === 0 && fs.existsSync(appBuildManifestPath)) {
    try {
      const appManifest = JSON.parse(fs.readFileSync(appBuildManifestPath, 'utf8'));
      const pages = appManifest.pages || {};

      for (const [pageKey, pageChunks] of Object.entries(pages)) {
        const route = normalizeRoute(pageKey);
        const allChunks = [...sharedChunks, ...(Array.isArray(pageChunks) ? pageChunks : [])];
        const stats = getChunkSizes(nextDir, allChunks);

        const existing = routeMap.get(route);
        if (!existing || stats.totalGzipBytes > existing.totalGzipBytes) {
          routeMap.set(route, {
            route,
            pageKey,
            ...stats,
          });
        }
      }
    } catch {
      // Fall through
    }
  }

  // Pattern 3: Pages router in build-manifest.json
  if (routeMap.size === 0 && fs.existsSync(buildManifestPath)) {
    try {
      const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
      const pages = buildManifest.pages || {};
      for (const [pageKey, pageChunks] of Object.entries(pages)) {
        if (pageKey === '/_app' || pageKey === '/_error' || pageKey === '/_document') continue;
        const allChunks = [...sharedChunks, ...(Array.isArray(pageChunks) ? pageChunks : [])];
        const stats = getChunkSizes(nextDir, allChunks);
        routeMap.set(pageKey, {
          route: pageKey,
          pageKey,
          ...stats,
        });
      }
    } catch {
      // Fall through
    }
  }

  return Array.from(routeMap.values()).sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Evaluates route sizes against committed budgets.
 */
export function evaluateBudgets(routeSizes, budgetConfig) {
  const budgets = budgetConfig.budgets || {};
  const defaultBudget = budgetConfig.defaultRouteBudgetKb ?? 450;
  const results = [];
  let hasFailures = false;

  for (const item of routeSizes) {
    const routeConfig = budgets[item.route];
    const budgetKb = routeConfig?.budgetKb ?? defaultBudget;
    const description = routeConfig?.description ?? '';
    const actualKb = item.totalGzipKb;
    const deltaKb = Number((actualKb - budgetKb).toFixed(1));
    const passed = actualKb <= budgetKb;

    if (!passed) {
      hasFailures = true;
    }

    results.push({
      route: item.route,
      pageKey: item.pageKey,
      description,
      budgetKb,
      actualKb,
      deltaKb,
      passed,
      chunks: item.chunks,
      topChunk: item.chunks[0] || null,
    });
  }

  return {
    results,
    hasFailures,
    passedCount: results.filter((r) => r.passed).length,
    failedCount: results.filter((r) => !r.passed).length,
    totalRoutes: results.length,
  };
}

/**
 * Formats Markdown summary for GitHub Actions ($GITHUB_STEP_SUMMARY).
 */
export function generateMarkdownSummary(evaluation) {
  const lines = [];
  lines.push('### 📦 JavaScript Bundle Size Budget Report');
  lines.push('');
  lines.push(
    `**Status**: ${
      evaluation.hasFailures
        ? `❌ **FAILED** (${evaluation.failedCount} route(s) exceeded budget)`
        : `✅ **PASSED** (All ${evaluation.passedCount} route(s) within budget)`
    }`
  );
  lines.push('');
  lines.push('| Route | First Load JS (gzip) | Budget | Delta | Status |');
  lines.push('|:------|:---------------------|:-------|:------|:------:|');

  for (const item of evaluation.results) {
    const statusIcon = item.passed ? '✅' : '❌';
    const deltaSign = item.deltaKb > 0 ? `+${item.deltaKb}` : `${item.deltaKb}`;
    lines.push(
      `| \`${item.route}\` | ${item.actualKb} kB | ${item.budgetKb} kB | ${deltaSign} kB | ${statusIcon} |`
    );
  }

  lines.push('');
  lines.push('<details><summary><b>Detailed Route Chunk Breakdown</b></summary>');
  lines.push('');

  for (const item of evaluation.results) {
    lines.push(`#### Route \`${item.route}\`${item.description ? ` — ${item.description}` : ''}`);
    lines.push(`- Total First Load JS: **${item.actualKb} kB** gzip (Budget: **${item.budgetKb} kB**)`);
    lines.push('- Largest chunks:');
    for (const chunk of item.chunks.slice(0, 5)) {
      lines.push(`  - \`${chunk.name}\`: ${chunk.gzipKb} kB gzip (${(chunk.rawBytes / 1024).toFixed(1)} kB uncompressed)`);
    }
    lines.push('');
  }

  lines.push('</details>');
  return lines.join('\n');
}

/**
 * Main execution function.
 */
export function main() {
  const args = process.argv.slice(2);
  const nextDir = path.resolve(process.cwd(), args[0] || '.next');
  const budgetPath = path.resolve(process.cwd(), args[1] || 'bundle-budget.json');

  if (!fs.existsSync(budgetPath)) {
    console.error(`❌ Budget file not found at: ${budgetPath}`);
    process.exit(1);
  }

  const budgetConfig = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

  let routeSizes;
  try {
    routeSizes = computeRouteSizes(nextDir);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const evaluation = evaluateBudgets(routeSizes, budgetConfig);

  console.log('\n📦 JavaScript Bundle Size Budget Check:');
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log(
    'Route'.padEnd(25) +
      'Actual (gzip)'.padEnd(16) +
      'Budget'.padEnd(12) +
      'Delta'.padEnd(12) +
      'Status'
  );
  console.log('────────────────────────────────────────────────────────────────────────');

  for (const item of evaluation.results) {
    const deltaSign = item.deltaKb > 0 ? `+${item.deltaKb}` : `${item.deltaKb}`;
    const statusText = item.passed ? '✅ PASS' : '❌ FAIL';
    console.log(
      item.route.padEnd(25) +
        `${item.actualKb} kB`.padEnd(16) +
        `${item.budgetKb} kB`.padEnd(12) +
        `${deltaSign} kB`.padEnd(12) +
        statusText
    );

    if (!item.passed && item.chunks.length > 0) {
      console.log(`   ⚠️ Top chunks for ${item.route}:`);
      for (const chunk of item.chunks.slice(0, 3)) {
        console.log(`      • ${chunk.name}: ${chunk.gzipKb} kB gzip`);
      }
    }
  }

  console.log('────────────────────────────────────────────────────────────────────────');

  // Write GitHub Actions Step Summary if in CI
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryMd = generateMarkdownSummary(evaluation);
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd + '\n');
    } catch (e) {
      console.warn(`Could not write to GITHUB_STEP_SUMMARY: ${e.message}`);
    }
  }

  if (evaluation.hasFailures) {
    console.error(
      `\n❌ FAILED: ${evaluation.failedCount} route(s) exceeded the committed bundle budget.\n` +
        `Inspect the chunk breakdown above and optimize dependencies or update bundle-budget.json deliberately.`
    );
    process.exit(1);
  } else {
    console.log(`\n✅ PASSED: All ${evaluation.passedCount} route(s) within committed bundle budgets.\n`);
    process.exit(0);
  }
}

// Auto-run when invoked directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
