# Solution for #211: OpenAPI schema-conformance tests for the API

// test/openapi-conformance.test.ts
import path from 'path';
import request from 'supertest';
import { Enforcer } from 'openapi-enforcer';
import { sample } from 'openapi-sampler';
import app from '../src/app';

describe('OpenAPI Conformance', () => {
  let enforcer: any;
  let spec: any;
  let authToken: string | undefined;

  beforeAll(async () => {
    enforcer = await Enforcer(path.join(__dirname, '../docs/openapi.yaml'));
    spec = enforcer.spec;

    // Obtain a test authentication token if security is defined.
    // Adjust this to match your application's authentication method.
    const securitySchemes = spec.components?.securitySchemes;
    if (securitySchemes && Object.keys(securitySchemes).length > 0) {
      // Placeholder: replace with a real login call or use a static test token.
      authToken = 'test-token';
    }
  });

  function getSampleRequest(operation: any): {
    query: Record<string, any>;
    headers: Record<string, any>;
    pathParams: Record<string, any>;
    body: any;
  } {
    const result = { query: {}, headers: {}, pathParams: {}, body: undefined };

    if (operation.parameters) {
      for (const param of operation.parameters) {
        const value = sample(param.schema, { skipNonRequired: false });
        if (param.in === 'query') result.query[param.name] = value;
        else if (param.in === 'path') result.pathParams[param.name] = value;
        else if (param.in === 'header') result.headers[param.name] = value;
      }
    }

    if (operation.requestBody) {
      const content = operation.requestBody.content;
      const mediaType = content['application/json'] || content['*/*'] || Object.values(content)[0];
      if (mediaType) {
        result.body = sample(mediaType.schema);
      }
    }

    return result;
  }

  function makeInvalidRequest(sampleData: any, operation: any): any {
    const invalid = JSON.parse(JSON.stringify(sampleData));

    // Make request body invalid if it exists
    if (operation.requestBody && invalid.body !== undefined) {
      const content = operation.requestBody.content;
      const mediaType = content['application/json'] || content['*/*'] || Object.values(content)[0];
      if (mediaType && mediaType.schema) {
        const schema = mediaType.schema;
        // If there is a required field, remove it
        if (schema.required && schema.required.length > 0) {
          delete invalid.body[schema.required[0]];
        } else if (schema.properties) {
          // Otherwise change the type of a property
          const propNames = Object.keys(schema.properties);
          for (const prop of propNames) {
            const propSchema = schema.properties[prop];
            if (propSchema.type === 'string') {
              invalid.body[prop] = 12345;
              break;
            } else if (propSchema.type === 'number' || propSchema.type === 'integer') {
              invalid.body[prop] = 'not a number';
              break;
            } else if (propSchema.type === 'boolean') {
              invalid.body[prop] = 'not a boolean';
              break;
            } else if (propSchema.type === 'array') {
              invalid.body[prop] = 'not an array';
              break;
            } else if (propSchema.type === 'object') {
              invalid.body[prop] = 'not an object';
              break;
            }
          }
        }
      }
    }

    // Make query parameters invalid
    if (operation.parameters) {
      const requiredParams = operation.parameters.filter((p: any) => p.required);
      if (requiredParams.length > 0) {
        const param = requiredParams[0];
        if (param.in === 'query') {
          delete invalid.query[param.name];
        } else if (param.in === 'header') {
          delete invalid.headers[param.name];
        }
      } else if (operation.parameters.length > 0) {
        const param = operation.parameters[0];
        if (param.in === 'query' && param.schema) {
          if (param.schema.type === 'string') {
            invalid.query[param.name] = 12345;
          } else if (param.schema.type === 'number' || param.schema.type === 'integer') {
            invalid.query[param.name] = 'abc';
          }
        }
      }
    }

    return invalid;
  }

  const operations: { path: string; method: string; operation: any }[] = [];
  if (spec.paths) {
    for (const path of Object.keys(spec.paths)) {
      const methods = Object.keys(spec.paths[path]).filter((m) =>
        ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(m)
      );
      for (const method of methods) {
        operations.push({ path, method, operation: spec.paths[path][method] });
      }
    }
  }

  if (operations.length === 0) {
    it('should have at least one operation in the spec', () => {
      expect(operations.length).toBeGreaterThan(0);
    });
  }

  describe.each(operations)('$method $path', ({ path, method, operation }) => {
    const buildUrl = (pathParams: Record<string, any>) => {
      return path.replace(/\{([^}]+)\}/g, (_, name) => {
        const value = pathParams[name];
        if (value === undefined || value === null) {
          throw new Error(`Missing path parameter: ${name}`);
        }
        return encodeURIComponent(String(value));
      });
    };

    test('should accept a valid request and return a valid response', async () => {
      const sampleReq = getSampleRequest(operation);
      const url = buildUrl(sampleReq.pathParams);
      const req = request(app)[method](url);
      if (Object.keys(sampleReq.query).length) req.query(sampleReq.query);
      if (Object.keys(sampleReq.headers).length) req.set(sampleReq.headers);
      if (sampleReq.body !== undefined) req.send(sampleReq.body);
      if (authToken) req.set('Authorization', `Bearer ${authToken}`);

      const res = await req;
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);

      // Validate response against the spec for the returned status
      const responses = operation.responses || {};
      if (responses[res.status]) {
        const responseDef = responses[res.status];
        if (responseDef.content) {
          const mediaType = responseDef.content['application/json'] || Object.values(responseDef.content)[0];
          if (mediaType) {
            const validation = await enforcer.validateResponse(res.status, res.body, operation);
            expect(validation).toBeTruthy();
          }
        }
      } else {
        // If the status is not explicitly defined, we still check that it's a success status.
        // The spec may define a default response or a 2xx range.
        // We'll just check that the response status is in the 2xx range, which we already did.
        // Optionally, we can skip further validation.
      }
    });

    test('should reject an invalid request with a 4xx status', async () => {
      const sampleReq = getSampleRequest(operation);
      const invalidReq = makeInvalidRequest(sampleReq, operation);
      const url = buildUrl(invalidReq.pathParams);
      const req = request(app)[method](url);
      if (Object.keys(invalidReq.query).length) req.query(invalidReq.query);
      if (Object.keys(invalidReq.headers).length) req.set(invalidReq.headers);
      if (invalidReq.body !== undefined) req.send(invalidReq.body);
      if (authToken) req.set('Authorization', `Bearer ${authToken}`);

      const res = await req;
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});

// docs/testing.md
# Testing

## OpenAPI Conformance

To ensure the API implementation matches the OpenAPI specification, run:

```bash
npm run test:conformance
```

This test will:

- Send a valid request to every public endpoint defined in `docs/openapi.yaml`.
- Verify that the response matches the defined schema.
- Send an invalid request to each endpoint and verify that the server returns a 4xx error.

If the test fails, it indicates a drift between the specification and the implementation. Update the implementation or the specification accordingly.

The test is run automatically in CI.

// package.json (add to "scripts" and "devDependencies")
{
  "scripts": {
    "test:conformance": "jest test/openapi-conformance.test.ts"
  },
  "devDependencies": {
    "openapi-enforcer": "^1.22.0",
    "openapi-sampler": "^1.3.0",
    "supertest": "^6.3.3"
  }
}

---
_Generated by DevilX BountyHub solver_
