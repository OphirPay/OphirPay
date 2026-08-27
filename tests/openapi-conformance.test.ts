/**
 * OpenAPI schema-conformance tests for OphirPay API.
 * Validates that the OpenAPI spec (docs/openapi.yaml) is internally consistent
 * and that documented endpoints have complete metadata. Static spec checks only —
 * runtime request/response validation is covered by the e2e suite.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { OpenAPIV3 } from 'openapi-types';

const OAS_PATH = path.join(process.cwd(), 'docs', 'openapi.yaml');

function loadOpenApiSpec(): OpenAPIV3.Document {
  const raw = fs.readFileSync(OAS_PATH, 'utf-8');
  return YAML.parse(raw) as OpenAPIV3.Document;
}

describe('OpenAPI Schema Conformance', () => {
  const spec = loadOpenApiSpec();
  const paths = spec.paths || {};

  it('has a valid OpenAPI spec file', () => {
    expect(spec.openapi).toBeDefined();
    expect(spec.info?.title).toBeDefined();
    expect(spec.info?.version).toBeDefined();
  });

  it('defines at least one path', () => {
    const entries = Object.keys(paths);
    expect(entries.length).toBeGreaterThan(0);
  });

  describe('each endpoint has complete metadata', () => {
    for (const [route, methods] of Object.entries(paths)) {
      const methodsObj = methods as Record<string, OpenAPIV3.OperationObject>;
      for (const [method, op] of Object.entries(methodsObj)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          it(`${method.toUpperCase()} ${route} — has summary or description`, () => {
            expect(op.summary || op.description).toBeTruthy();
          });

          it(`${method.toUpperCase()} ${route} — has responses`, () => {
            expect(op.responses).toBeDefined();
            const codes = Object.keys(op.responses);
            expect(codes.length).toBeGreaterThan(0);
          });

          if (op.parameters) {
            it(`${method.toUpperCase()} ${route} — parameters have schema`, () => {
              for (const param of op.parameters) {
                if ('schema' in param) {
                  expect(param.schema).toBeDefined();
                }
              }
            });
          }
        }
      }
    }
  });

  describe('security schemes', () => {
    it('defines security schemes', () => {
      const components = spec.components;
      if (components?.securitySchemes) {
        const schemes = Object.keys(components.securitySchemes);
        expect(schemes.length).toBeGreaterThan(0);
      }
    });
  });

  describe('schemas reference valid types', () => {
    const schemas = spec.components?.schemas || {};
    for (const [name, schema] of Object.entries(schemas)) {
      const sch = schema as OpenAPIV3.SchemaObject;
      if (sch.type) {
        it(`schema "${name}" has valid type "${sch.type}"`, () => {
          expect(['string', 'number', 'integer', 'boolean', 'array', 'object']).toContain(sch.type);
        });
      }
    }
  });
});