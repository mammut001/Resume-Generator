import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOtlpHttpJsonObservabilitySink } from '../src/observability/otlpSink';
import { createObservabilitySummaryStore } from '../src/observability/summaryStore';

describe('OTLP observability sink', () => {
  let tempDirectory: string | undefined;

  afterEach(() => {
    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  });

  it('exports request observations and domain events to the OTLP logs endpoint', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: `${input}`, init });
      return new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    const sink = createOtlpHttpJsonObservabilitySink({
      endpoint: 'https://collector.example.com/v1/logs',
      headers: {
        Authorization: 'Bearer token',
      },
      serviceName: 'resume-generator-backend',
      serviceVersion: '1.0.0',
      deploymentEnvironment: 'test',
      fetchImpl,
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
    });

    sink.recordRequest({
      occurredAt: '2026-05-18T00:00:00.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      method: 'POST',
      statusCode: 422,
      durationMs: 32,
      requestBytes: 128,
      responseBytes: 256,
      origin: 'http://localhost:5173',
      contentType: 'application/json',
      ipHash: 'ip-hash',
      networkHash: 'network-hash',
      userAgentFamily: 'node',
      errorCode: 'TYPST_COMPILE_ERROR',
    });
    sink.recordEvent({
      occurredAt: '2026-05-18T00:00:01.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      eventName: 'render_failed',
      payload: {
        errorCode: 'TYPST_COMPILE_ERROR',
      },
    });

    await sink.close?.();

    const diagnostics = sink.getDiagnostics?.().otlp;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://collector.example.com/v1/logs');
    expect(requests[0]?.init?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    });

    const body = JSON.parse(`${requests[0]?.init?.body || ''}`);
    const resourceAttributes = body.resourceLogs[0].resource.attributes;
    const logRecords = body.resourceLogs[0].scopeLogs[0].logRecords;

    expect(resourceAttributes).toEqual(expect.arrayContaining([
      { key: 'service.name', value: { stringValue: 'resume-generator-backend' } },
      { key: 'service.version', value: { stringValue: '1.0.0' } },
      { key: 'deployment.environment', value: { stringValue: 'test' } },
    ]));
    expect(logRecords).toHaveLength(2);
    expect(logRecords[0]).toMatchObject({
      severityText: 'WARN',
      severityNumber: 13,
      body: { stringValue: 'request_observation' },
    });
    expect(logRecords[1]).toMatchObject({
      severityText: 'ERROR',
      severityNumber: 17,
      body: { stringValue: 'render_failed' },
    });
    expect(diagnostics).toMatchObject({
      queueDepth: 0,
      queueCapacity: 1000,
      dropPolicy: 'oldest',
      inFlight: false,
      successfulExports: 1,
      failedExports: 0,
      exportedLogRecords: 2,
      droppedLogRecords: 0,
      droppedOverflowLogRecords: 0,
      droppedFailedExportLogRecords: 0,
      retryCount: 0,
      lastSuccessAt: expect.any(String),
    });
  });

  it('retries retryable OTLP failures with backoff and counts dropped records after exhaustion', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sleepCalls: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: `${input}`, init });
      return new Response('{}', {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    const sink = createOtlpHttpJsonObservabilitySink({
      endpoint: 'https://collector.example.com/v1/logs',
      serviceName: 'resume-generator-backend',
      fetchImpl,
      flushIntervalMs: 60_000,
      maxBatchSize: 100,
      maxRetries: 2,
      initialBackoffMs: 5,
      maxBackoffMs: 20,
      sleepImpl: async delayMs => {
        sleepCalls.push(delayMs);
      },
    });

    sink.recordRequest({
      occurredAt: '2026-05-18T00:00:00.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      method: 'POST',
      statusCode: 500,
      durationMs: 32,
      requestBytes: 128,
      responseBytes: 256,
      origin: 'http://localhost:5173',
      contentType: 'application/json',
      ipHash: 'ip-hash',
      networkHash: 'network-hash',
      userAgentFamily: 'node',
      errorCode: 'INTERNAL_ERROR',
    });
    sink.recordEvent({
      occurredAt: '2026-05-18T00:00:01.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      eventName: 'render_failed',
      payload: {
        errorCode: 'INTERNAL_ERROR',
      },
    });

    await sink.close?.();

    expect(requests).toHaveLength(3);
    expect(sleepCalls).toEqual([5, 10]);
    expect(sink.getDiagnostics?.().otlp).toMatchObject({
      queueDepth: 0,
      queueCapacity: 1000,
      dropPolicy: 'oldest',
      inFlight: false,
      successfulExports: 0,
      failedExports: 1,
      exportedLogRecords: 0,
      droppedLogRecords: 2,
      droppedOverflowLogRecords: 0,
      droppedFailedExportLogRecords: 2,
      retryCount: 2,
      lastErrorAt: expect.any(String),
      lastErrorMessage: 'OTLP logs export failed with status 503.',
    });
  });

  it('persists OTLP diagnostic history samples to sqlite so a fresh summary store can read them', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'resume-otlp-history-'));
    const sqlitePath = join(tempDirectory, 'observability.sqlite');

    const sink = createOtlpHttpJsonObservabilitySink({
      endpoint: 'https://collector.example.com/v1/logs',
      serviceName: 'resume-generator-backend',
      sqlitePath,
      fetchImpl: async () => new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
      flushIntervalMs: 60_000,
      maxBatchSize: 10,
      maxQueueSize: 2,
      dropPolicy: 'oldest',
    });

    sink.recordRequest(buildObservation('request-1'));
    sink.recordRequest(buildObservation('request-2'));
    sink.recordRequest(buildObservation('request-3'));

    await sink.close?.();

    const summaryStore = createObservabilitySummaryStore(sqlitePath);
    const summary = summaryStore.getSummary(24);
    summaryStore.close();

    expect(summary.sinks?.otlp?.history?.samples.length).toBeGreaterThan(0);
    expect(summary.sinks?.otlp?.history?.samples.at(-1)).toMatchObject({
      queueDepth: 0,
      queueCapacity: 2,
      dropPolicy: 'oldest',
      successfulExports: 1,
      droppedLogRecords: 1,
      droppedOverflowLogRecords: 1,
      droppedFailedExportLogRecords: 0,
    });
  });

  it('drops the oldest queued records when the queue exceeds its configured capacity', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: `${input}`, init });
      return new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    const sink = createOtlpHttpJsonObservabilitySink({
      endpoint: 'https://collector.example.com/v1/logs',
      serviceName: 'resume-generator-backend',
      fetchImpl,
      flushIntervalMs: 60_000,
      maxBatchSize: 10,
      maxQueueSize: 2,
      dropPolicy: 'oldest',
    });

    sink.recordRequest(buildObservation('request-1'));
    sink.recordRequest(buildObservation('request-2'));
    sink.recordRequest(buildObservation('request-3'));

    await sink.close?.();

    const logRecords = readLogRecords(requests[0]);

    expect(requests).toHaveLength(1);
    expect(getAttributeValue(logRecords[0], 'request.id')).toBe('request-2');
    expect(getAttributeValue(logRecords[1], 'request.id')).toBe('request-3');
    expect(sink.getDiagnostics?.().otlp).toMatchObject({
      queueCapacity: 2,
      dropPolicy: 'oldest',
      droppedLogRecords: 1,
      droppedOverflowLogRecords: 1,
      droppedFailedExportLogRecords: 0,
      exportedLogRecords: 2,
    });
  });

  it('drops incoming newest records when configured with the newest overflow policy', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: `${input}`, init });
      return new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    const sink = createOtlpHttpJsonObservabilitySink({
      endpoint: 'https://collector.example.com/v1/logs',
      serviceName: 'resume-generator-backend',
      fetchImpl,
      flushIntervalMs: 60_000,
      maxBatchSize: 10,
      maxQueueSize: 2,
      dropPolicy: 'newest',
    });

    sink.recordRequest(buildObservation('request-1'));
    sink.recordRequest(buildObservation('request-2'));
    sink.recordRequest(buildObservation('request-3'));

    await sink.close?.();

    const logRecords = readLogRecords(requests[0]);

    expect(requests).toHaveLength(1);
    expect(getAttributeValue(logRecords[0], 'request.id')).toBe('request-1');
    expect(getAttributeValue(logRecords[1], 'request.id')).toBe('request-2');
    expect(sink.getDiagnostics?.().otlp).toMatchObject({
      queueCapacity: 2,
      dropPolicy: 'newest',
      droppedLogRecords: 1,
      droppedOverflowLogRecords: 1,
      droppedFailedExportLogRecords: 0,
      exportedLogRecords: 2,
    });
  });
});

function buildObservation(requestId: string) {
  return {
    occurredAt: '2026-05-18T00:00:00.000Z',
    requestId,
    routeId: 'render_typst' as const,
    method: 'POST',
    statusCode: 200,
    durationMs: 32,
    requestBytes: 128,
    responseBytes: 256,
    origin: 'http://localhost:5173',
    contentType: 'application/json',
    ipHash: 'ip-hash',
    networkHash: 'network-hash',
    userAgentFamily: 'node',
    errorCode: null,
  };
}

function readLogRecords(request: { url: string; init: RequestInit | undefined } | undefined) {
  const body = JSON.parse(`${request?.init?.body || ''}`);
  return body.resourceLogs[0].scopeLogs[0].logRecords as Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }>;
}

function getAttributeValue(
  logRecord: { attributes: Array<{ key: string; value: { stringValue?: string } }> },
  key: string,
) {
  return logRecord.attributes.find(attribute => attribute.key === key)?.value.stringValue;
}