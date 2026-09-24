// SPDX-License-Identifier: Apache-2.0
import { getRequestId } from './request-id.js';
import { trace } from '@opentelemetry/api';

const REDACTED_FIELDS = new Set(['password', 'secret', 'token', 'private_key']);

export const getRequestId = () => {
  const span = trace.getActiveSpan();
  return span?.getAttribute('http.request_id') || null;
};

export const redact = (obj) => {
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
};