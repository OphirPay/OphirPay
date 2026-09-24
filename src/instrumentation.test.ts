// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTracing, withRequestId } from './instrumentation.js';
import { getRequestId, setRequestId } from './lib/request-id.js';
import { trace } from '@opentelemetry/api';

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: class { register() {} },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPExporter: class { export() {} },
}));

describe('OpenTelemetry Instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRACE_SAMPLE_RATE = '1.0';
  });

  it('should propagate request-id to active span', () => {
    const mockSpan = {
      setAttribute: vi.fn(),
    };
    trace.setActiveSpan(mockSpan);

    const testId = 'test-request-id-123';
    setRequestId(testId);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.request_id', testId);
  });

  it('should return request-id from span if available', () => {
    const mockSpan = {
      getAttribute: vi.fn(() => 'span-request-id'),
    };
    trace.setActiveSpan(mockSpan);

    expect(getRequestId()).toBe('span-request-id');
  });

  it('should fall back to header if no span', () => {
    vi.mock('./lib/request-logging', () => ({
      getRequestId: () => 'header-request-id',
    }));

    trace.setActiveSpan(null);
    expect(getRequestId()).toBe('header-request-id');
  });
});