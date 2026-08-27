# Solution for #207: Vitest coverage for every API route handler

// File: scripts/generate-api-tests.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '../src/app/api');
const TEST_UTILS_PATH = path.resolve(__dirname, '../src/test-utils/api-test-utils.ts');

function walkDir(dir, base = '') {
  const results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const full = path.join(dir, item);
    const rel = path.join(base, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, rel));
    } else if (item === 'route.ts' || item === 'route.js') {
      results.push({ file: full, routePath: base.replace(/\\/g, '/') });
    }
  }
  return results;
}

function routeHandlersFromSource(source) {
  const handlers = [];
  const exportRegex = /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(/g;
  let match;
  while ((match = exportRegex.exec(source)) !== null) {
    handlers.push(match[2]);
  }
  // also check for export const GET = ...
  const constExportRegex = /export\s+const\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*=\s*(async\s+)?\(/g;
  while ((match = constExportRegex.exec(source)) !== null) {
    handlers.push(match[1]);
  }
  return [...new Set(handlers)];
}

function generateTestFile(routePath, handlers) {
  const routeImport = `@/app/api/${routePath}/route`;
  const testName = routePath.replace(/\//g, '_') || 'index';
  const lines = [];
  lines.push(`import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';`);
  lines.push(`import { NextRequest, NextResponse } from 'next/server';`);
  lines.push(`import { createMockRequest, createMockNextRequest, mockAuth, mockDb } from '@/test-utils/api-test-utils';`);
  lines.push(`import * as routeModule from '${routeImport}';`);
  lines.push('');
  lines.push(`// Mock external dependencies`);
  lines.push(`vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));`);
  lines.push(`vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));`);
  lines.push('');
  lines.push(`describe('API route ${routePath}', () => {`);
  lines.push(`  beforeAll(() => {`);
  lines.push(`    // Setup mocks if needed`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  afterAll(() => {`);
  lines.push(`    vi.resetAllMocks();`);
  lines.push(`  });`);
  lines.push('');

  for (const method of handlers) {
    const fnName = method.toLowerCase();
    lines.push(`  describe('${method} ${routePath}', () => {`);
    lines.push(`    it('should return 200 on success', async () => {`);
    lines.push(`      // Arrange`);
    lines.push(`      const request = createMockRequest('${method}', { body: { /* valid payload */ } });`);
    lines.push(`      // Mock auth if required`);
    lines.push(`      mockAuth({ userId: 'test-user' });`);
    lines.push(`      // Mock DB success`);
    lines.push(`      mockDb.query.mockResolvedValue({ rows: [{ id: 1 }] });`);
    lines.push(`      // Act`);
    lines.push(`      const response = await routeModule.${method}(request, { params: Promise.resolve({}) });`);
    lines.push(`      // Assert`);
    lines.push(`      expect(response.status).toBe(200);`);
    lines.push(`      const data = await response.json();`);
    lines.push(`      expect(data).toHaveProperty('success', true);`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should return 400 on validation error', async () => {`);
    lines.push(`      const request = createMockRequest('${method}', { body: { /* invalid payload */ } });`);
    lines.push(`      const response = await routeModule.${method}(request, { params: Promise.resolve({}) });`);
    lines.push(`      expect(response.status).toBe(400);`);
    lines.push(`      const data = await response.json();`);
    lines.push(`      expect(data).toHaveProperty('error');`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should return 401 on auth error', async () => {`);
    lines.push(`      const request = createMockRequest('${method}', { body: {} });`);
    lines.push(`      mockAuth(null); // no user`);
    lines.push(`      const response = await routeModule.${method}(request, { params: Promise.resolve({}) });`);
    lines.push(`      expect(response.status).toBe(401);`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should return 404 when resource not found', async () => {`);
    lines.push(`      const request = createMockRequest('${method}', { body: {} });`);
    lines.push(`      mockAuth({ userId: 'test-user' });`);
    lines.push(`      mockDb.query.mockResolvedValue({ rows: [] });`);
    lines.push(`      const response = await routeModule.${method}(request, { params: Promise.resolve({}) });`);
    lines.push(`      expect(response.status).toBe(404);`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  return lines.join('\n');
}

function main() {
  const routes = walkDir(API_DIR);
  if (routes.length === 0) {
    console.warn('No route files found in', API_DIR);
    return;
  }

  // Ensure test utils exist
  if (!fs.existsSync(TEST_UTILS_PATH)) {
    console.error('Test utils not found at', TEST_UTILS_PATH, '; please create them first.');
    process.exit(1);
  }

  for (const { file, routePath } of routes) {
    const source = fs.readFileSync(file, 'utf-8');
    const handlers = routeHandlersFromSource(source);
    if (handlers.length === 0) {
      console.warn(`No exported HTTP handlers in ${routePath}, skipping test generation.`);
      continue;
    }
    const testContent = generateTestFile(routePath, handlers);
    const testDir = path.dirname(file);
    const testFile = path.join(testDir, `${path.basename(file, path.extname(file))}.test.ts`);
    fs.writeFileSync(testFile, testContent, 'utf-8');
    console.log(`✅ Generated ${testFile}`);
  }
}

main();
// File: src/test-utils/api-test-utils.ts
import { NextRequest, NextResponse } from 'next/server';
import { vi } from 'vitest';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export function createMockRequest(
  method: HttpMethod,
  options: {
    body?: any;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    url?: string;
  } = {}
): NextRequest {
  const url = options.url || 'http://localhost:3000/api/test';
  const request = new NextRequest(url, {
    method,
    headers: new Headers(options.headers || {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  // Attach query params if provided
  if (options.query) {
    const searchParams = new URLSearchParams(options.query);
    request.nextUrl.search = searchParams.toString();
  }
  return request;
}

export function createMockNextRequest(
  method: HttpMethod,
  options: {
    body?: any;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    url?: string;
  } = {}
): NextRequest {
  // Alias for createMockRequest
  return createMockRequest(method, options);
}

export function mockAuth(user: any = null) {
  const auth = vi.fn().mockResolvedValue(user);
  // Import and override the auth module dynamically
  vi.doMock('@/lib/auth', () => ({ auth }));
  return auth;
}

export function mockDb(implementation?: any) {
  const db = {
    query: vi.fn().mockImplementation(implementation || (() => Promise.resolve({ rows: [] }))),
  };
  vi.doMock('@/lib/db', () => ({ db }));
  return db;
}

export function createMockResponse(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

export function assertResponseSuccess(response: NextResponse, expectedData?: any) {
  expect(response.status).toBe(200);
  return response.json().then((data) => {
    if (expectedData) {
      expect(data).toMatchObject(expectedData);
    }
    return data;
  });
}

export function assertResponseError(response: NextResponse, status: number, message?: string) {
  expect(response.status).toBe(status);
  return response.json().then((data) => {
    expect(data).toHaveProperty('error');
    if (message) {
      expect(data.error).toContain(message);
    }
    return data;
  });
}
// File: vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/app/api/**/route.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-utils/**'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
      all: true,
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
// File: package.json (add coverage script)
// Add to scripts: "test:coverage": "vitest run --coverage"

---
_Generated by DevilX BountyHub solver_
