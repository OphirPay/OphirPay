// SPDX-License-Identifier: Apache-2.0
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PrismaInstrumentation } from '@opentelemetry/instrumentation-prisma';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { AlwaysOnSampler } from '@opentelemetry/core';
import { OTLPExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { setGlobalTracerProvider } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { getEnv } from './lib/env.js';
import { getRequestId } from './lib/request-id.js';

const { OTLP_ENDPOINT, TRACE_SAMPLE_RATE = '0.0' } = getEnv();

const shouldInstrument = () => {
  const rate = parseFloat(TRACE_SAMPLE_RATE);
  return !isNaN(rate) && rate > 0;
};

export const initTracing = () => {
  if (!shouldInstrument()) return;

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'ophir-pay',
  });

  const provider = new NodeTracerProvider({
    resource,
    sampler: new AlwaysOnSampler(),
  });

  const exporter = new OTLPExporter({
    url: OTLP_ENDPOINT,
  });

  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
  setGlobalTracerProvider(provider);

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new PrismaInstrumentation(),
      new FetchInstrumentation(),
      ...getNodeAutoInstrumentations(),
    ],
  });
};

// Propagate request-id as trace attribute for correlation
export const withRequestId = (span, requestId) => {
  if (!span) return;
  span.setAttribute('http.request_id', requestId);
};

class SimpleSpanProcessor {
  constructor(exporter) {
    this.exporter = exporter;
  }

  onStart(span) {
    const requestId = getRequestId();
    if (requestId) span.setAttribute('http.request_id', requestId);
  }

  async onEnd(span) {
    await this.exporter.export([span]);
  }

  onError(span) {}
}