import { readFileSync } from 'fs';
import { OpenAPIV3 } from 'openapi-types';
import { expect, test } from '@jest/globals';

const openapiSpec = JSON.parse(readFileSync('./docs/openapi.yaml', 'utf8')) as OpenAPIV3.Document;

test('every path has request/response examples', () => {
  const paths = openapiSpec.paths;
  const pathKeys = Object.keys(paths);

  pathKeys.forEach(path => {
    const methods = paths[path];
    const methodKeys = Object.keys(methods);

    methodKeys.forEach(method => {
      const operation = methods[method];

      // Check requestBody examples (for mutating paths)
      if (operation.requestBody) {
        const content = operation.requestBody.content;
        const exampleKeys = Object.keys(content['application/json'].examples);
        expect(exampleKeys.length > 0, `Path ${path} ${method} missing request example`).toBe(true);
      }

      // Check response examples (for all paths)
      const responses = operation.responses;
      const responseKeys = Object.keys(responses);

      responseKeys.forEach(status => {
        const response = responses[status];
        if (response.content) {
          const exampleKeys = Object.keys(response.content['application/json'].examples);
          expect(exampleKeys.length > 0, `Path ${path} ${method} ${status} missing response example`).toBe(true);
        }
      });
    });
  });
});
