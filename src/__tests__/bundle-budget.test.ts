import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  normalizeRoute,
  evaluateBudgets,
  generateMarkdownSummary,
} from '../../scripts/check-bundle-budget.mjs';

describe('Bundle Size Budget Configuration & Script (Issue #739)', () => {
  const rootDir = process.cwd();
  const budgetPath = path.join(rootDir, 'bundle-budget.json');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const nextConfigPath = path.join(rootDir, 'next.config.ts');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');
  const docsPath = path.join(rootDir, 'docs/BUNDLE_BUDGET.md');

  it('validates bundle-budget.json structure and required route budgets', () => {
    expect(fs.existsSync(budgetPath)).toBe(true);
    const budgetConfig = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

    expect(budgetConfig.budgets).toBeDefined();
    expect(budgetConfig.defaultRouteBudgetKb).toBeGreaterThan(0);

    const trackedRoutes = Object.keys(budgetConfig.budgets);
    expect(trackedRoutes).toContain('/');
    expect(trackedRoutes).toContain('/analytics');
    expect(trackedRoutes).toContain('/payments');
    expect(trackedRoutes).toContain('/batches');
    expect(trackedRoutes).toContain('/webhooks');
    expect(trackedRoutes).toContain('/keys');
    expect(trackedRoutes).toContain('/hooks');
    expect(trackedRoutes).toContain('/fee-config');
    expect(trackedRoutes).toContain('/rbac');

    for (const route of trackedRoutes) {
      const item = budgetConfig.budgets[route];
      expect(item.budgetKb).toBeGreaterThan(0);
      expect(typeof item.description).toBe('string');
    }
  });

  it('normalizes Next.js App Router internal page keys properly', () => {
    expect(normalizeRoute('/(dashboard)/page')).toBe('/');
    expect(normalizeRoute('/page')).toBe('/');
    expect(normalizeRoute('/analytics/page')).toBe('/analytics');
    expect(normalizeRoute('/batches/[id]/page')).toBe('/batches/[id]');
    expect(normalizeRoute('/webhooks/[id]/page')).toBe('/webhooks/[id]');
    expect(normalizeRoute('/(admin)/keys/page')).toBe('/keys');
  });

  it('evaluates passing routes correctly without failure flag', () => {
    const mockRouteSizes = [
      {
        route: '/',
        pageKey: '/(dashboard)/page',
        totalGzipKb: 180.5,
        totalRawKb: 650.0,
        chunks: [
          { name: 'framework.js', gzipKb: 100.0, rawBytes: 350000 },
          { name: 'dashboard.js', gzipKb: 80.5, rawBytes: 300000 },
        ],
      },
      {
        route: '/analytics',
        pageKey: '/analytics/page',
        totalGzipKb: 240.0,
        totalRawKb: 800.0,
        chunks: [
          { name: 'charts.js', gzipKb: 140.0, rawBytes: 450000 },
          { name: 'analytics.js', gzipKb: 100.0, rawBytes: 350000 },
        ],
      },
    ];

    const budgetConfig = {
      budgets: {
        '/': { budgetKb: 300, description: 'Dashboard' },
        '/analytics': { budgetKb: 350, description: 'Analytics' },
      },
      defaultRouteBudgetKb: 300,
    };

    const evaluation = evaluateBudgets(mockRouteSizes, budgetConfig);
    expect(evaluation.hasFailures).toBe(false);
    expect(evaluation.passedCount).toBe(2);
    expect(evaluation.failedCount).toBe(0);

    const rootResult = evaluation.results.find((r) => r.route === '/');
    expect(rootResult).toBeDefined();
    expect(rootResult?.passed).toBe(true);
    expect(rootResult?.deltaKb).toBe(-119.5);
  });

  it('detects when a route exceeds its budget and flags failure with chunk details', () => {
    const mockRouteSizes = [
      {
        route: '/analytics',
        pageKey: '/analytics/page',
        totalGzipKb: 400.0,
        totalRawKb: 1200.0,
        chunks: [
          { name: 'huge-vendor-library.js', gzipKb: 250.0, rawBytes: 800000 },
          { name: 'chart.js', gzipKb: 150.0, rawBytes: 400000 },
        ],
      },
    ];

    const budgetConfig = {
      budgets: {
        '/analytics': { budgetKb: 350, description: 'Analytics' },
      },
      defaultRouteBudgetKb: 300,
    };

    const evaluation = evaluateBudgets(mockRouteSizes, budgetConfig);
    expect(evaluation.hasFailures).toBe(true);
    expect(evaluation.passedCount).toBe(0);
    expect(evaluation.failedCount).toBe(1);

    const result = evaluation.results[0];
    expect(result.passed).toBe(false);
    expect(result.deltaKb).toBe(50.0);
    expect(result.topChunk?.name).toBe('huge-vendor-library.js');
    expect(result.topChunk?.gzipKb).toBe(250.0);
  });

  it('generates markdown summary with table and chunk details for CI', () => {
    const evaluation = {
      results: [
        {
          route: '/',
          description: 'Home',
          budgetKb: 300,
          actualKb: 180,
          deltaKb: -120,
          passed: true,
          chunks: [{ name: 'app.js', gzipKb: 180, rawBytes: 500000 }],
        },
        {
          route: '/heavy',
          description: 'Heavy route',
          budgetKb: 250,
          actualKb: 310,
          deltaKb: 60,
          passed: false,
          chunks: [{ name: 'bundle.js', gzipKb: 310, rawBytes: 900000 }],
        },
      ],
      hasFailures: true,
      passedCount: 1,
      failedCount: 1,
      totalRoutes: 2,
    };

    const md = generateMarkdownSummary(evaluation);
    expect(md).toContain('JavaScript Bundle Size Budget Report');
    expect(md).toContain('| Route | First Load JS (gzip) | Budget | Delta | Status |');
    expect(md).toContain('| `/` | 180 kB | 300 kB | -120 kB | ✅ |');
    expect(md).toContain('| `/heavy` | 310 kB | 250 kB | +60 kB | ❌ |');
    expect(md).toContain('Detailed Route Chunk Breakdown');
    expect(md).toContain('bundle.js');
  });

  it('verifies package.json scripts and next.config.ts bundle analyzer wrapper', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    expect(packageJson.scripts.analyze).toBe('ANALYZE=true next build');
    expect(packageJson.scripts['bundle:check']).toBe('node scripts/check-bundle-budget.mjs');
    expect(packageJson.devDependencies['@next/bundle-analyzer']).toBeDefined();

    const nextConfig = fs.readFileSync(nextConfigPath, 'utf8');
    expect(nextConfig).toMatch(/@next\/bundle-analyzer/);
    expect(nextConfig).toMatch(/process\.env\.ANALYZE === "true"/);
  });

  it('verifies CI workflow has bundle-size check job', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toContain('bundle-size:');
    expect(ciContent).toContain('npm run analyze');
    expect(ciContent).toContain('node scripts/check-bundle-budget.mjs');
    expect(ciContent).toContain('actions/upload-artifact@');
  });

  it('verifies docs/BUNDLE_BUDGET.md exists and documents the process', () => {
    expect(fs.existsSync(docsPath)).toBe(true);
    const docs = fs.readFileSync(docsPath, 'utf8');
    expect(docs).toContain('JavaScript Bundle Size Budget Guide');
    expect(docs).toContain('npm run analyze');
    expect(docs).toContain('npm run bundle:check');
  });
});
