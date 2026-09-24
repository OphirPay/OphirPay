// SPDX-License-Identifier: Apache-2.0
import { getRequestId as getRequestIdHeader } from './request-logging.js';
import { trace } from '@opentelemetry/api';

const TRACE_CONTEXT_HEADER = 'x-request-id';

export const getRequestId = () => {
  const span = trace.getActiveSpan();
  if (span) {
    const requestId = span.getAttribute('http.request_id');
    if (requestId) return requestId;
  }
  return getRequestIdHeader() || crypto.randomUUID();
};

export const setRequestId = (requestId) => {
  const span = trace.getActiveSpan();
  if (span) span.setAttribute('http.request_id', requestId);
};

export const getRequestIdHeader = () => {
  const header = getRequestIdHeader();
  if (header) setRequestId(header);
  return header;
};