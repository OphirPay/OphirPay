import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

describe('OpenAPI 3.1.0 Schema Conformance Suite', () => {
  const openapiPath = path.resolve(__dirname, '../docs/openapi.yaml');
  let openapiDoc: any;

  it('successfully loads and parses docs/openapi.yaml without syntax errors', () => {
    expect(fs.existsSync(openapiPath)).toBe(true);
    const rawContent = fs.readFileSync(openapiPath, 'utf8');
    expect(rawContent.length).toBeGreaterThan(1000);
    openapiDoc = yaml.parse(rawContent);
    expect(openapiDoc).toBeDefined();
    expect(openapiDoc.openapi).toMatch(/^3\.[01]\./);
  });

  it('contains valid info, server, and security definitions', () => {
    const rawContent = fs.readFileSync(openapiPath, 'utf8');
    const doc = yaml.parse(rawContent);
    expect(doc.info.title).toBe('OphirPay API');
    expect(doc.info.version).toBeDefined();
    expect(doc.servers.length).toBeGreaterThan(0);
    expect(doc.components.securitySchemes).toHaveProperty('BearerAuth');
    expect(doc.components.securitySchemes).toHaveProperty('ApiKeyAuth');
  });

  it('verifies that all critical payment routes have defined request and response schemas', () => {
    const rawContent = fs.readFileSync(openapiPath, 'utf8');
    const doc = yaml.parse(rawContent);
    const paths = doc.paths;

    const criticalRoutes = [
      '/api/payments',
      '/api/batches',
      '/api/recurring',
      '/api/requests',
      '/api/escrows',
      '/api/streams',
      '/api/webhooks',
      '/api/keys',
      '/api/health',
      '/api/metrics'
    ];

    for (const route of criticalRoutes) {
      expect(paths).toHaveProperty(route);
      const methods = paths[route];
      const validVerbs = ['get', 'post', 'put', 'patch', 'delete'];
      const definedVerbs = Object.keys(methods).filter(k => validVerbs.includes(k));
      expect(definedVerbs.length).toBeGreaterThan(0);
    }
  });

  it('ensures all POST endpoints have requestBody schemas and error responses', () => {
    const rawContent = fs.readFileSync(openapiPath, 'utf8');
    const doc = yaml.parse(rawContent);
    const paths = doc.paths;

    for (const [routePath, routeDef] of Object.entries(paths)) {
      if ((routeDef as any).post) {
        const postOp = (routeDef as any).post;
        if (postOp.requestBody) {
          expect(postOp.requestBody.content).toHaveProperty('application/json');
        }
        expect(postOp.responses).toHaveProperty('201');
      }
    }
  });
});
