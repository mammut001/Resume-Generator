import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, RenderApp } from '../src/app';
import { createOtlpHttpJsonObservabilitySink } from '../src/observability/otlpSink';
import { createSqliteObservabilitySink } from '../src/observability/sqliteSink';
import { ObservabilitySink } from '../src/observability/types';

describe('observability summary route', () => {
  let tempDirectory: string | undefined;
  let app: RenderApp | undefined;
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
      });
    }

    await app?.close();
    server = undefined;
    app = undefined;
    baseUrl = '';

    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  });

  it('returns a read-only aggregated summary from sqlite-backed observability data', async () => {
    await startServer({ seedData: true });

    const response = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.windowHours).toBe(24);
    expect(payload.requests.total).toBe(5);
    expect(payload.requests.errorCount).toBe(3);
    expect(payload.requests.errorRate).toBe(0.6);
    expect(payload.requests.p95DurationMs).toBe(100);
    expect(
      payload.requests.recentCounts.reduce(
        (totals: { requestCount: number; errorCount: number }, bucket: { requestCount: number; errorCount: number }) => ({
          requestCount: totals.requestCount + bucket.requestCount,
          errorCount: totals.errorCount + bucket.errorCount,
        }),
        { requestCount: 0, errorCount: 0 },
      ),
    ).toEqual({ requestCount: 5, errorCount: 3 });
    expect(payload.recentFailures).toEqual(expect.arrayContaining([
      {
        routeId: 'render_typst',
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        count: 2,
        lastOccurredAt: expect.any(String),
      },
      {
        routeId: 'intake_text',
        statusCode: 429,
        errorCode: 'QUOTA_EXCEEDED',
        count: 1,
        lastOccurredAt: expect.any(String),
      },
    ]));
    expect(payload.topRoutes[0]).toMatchObject({
      routeId: 'health',
      requestCount: 2,
      errorCount: 0,
    });
    expect(payload.topIpHashes[0]).toMatchObject({
      ipHash: 'ip-hash-a',
      requestCount: 4,
      errorCount: 2,
    });
    expect(payload.eventCounts).toEqual(expect.arrayContaining([
      { eventName: 'render_failed', count: 2 },
      { eventName: 'quota_exceeded', count: 1 },
    ]));
  });

  it('requires a bearer token', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/observability/summary`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates the admin token and persists it across restart without polluting summary counts', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'resume-observability-summary-'));
    const sqlitePath = join(tempDirectory, 'observability.sqlite');
    const sink = createSqliteObservabilitySink(sqlitePath);

    sink.recordRequest({
      occurredAt: new Date(Date.now() - (5 * 60 * 1_000)).toISOString(),
      requestId: 'request-1',
      routeId: 'health',
      method: 'GET',
      statusCode: 200,
      durationMs: 10,
      requestBytes: null,
      responseBytes: 64,
      origin: 'http://localhost:5173',
      contentType: 'application/json',
      ipHash: 'ip-hash-a',
      networkHash: 'ip-hash-a-network',
      userAgentFamily: 'node',
      errorCode: null,
    });
    sink.close?.();

    await startServerWithSqlitePath(sqlitePath);

    const rotateResponse = await fetch(`${baseUrl}/api/observability/admin/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newToken: 'test-observability-rotated-token' }),
    });
    const rotatePayload = await rotateResponse.json();

    expect(rotateResponse.status).toBe(200);
    expect(rotatePayload).toMatchObject({
      success: true,
      tokenUpdatedAt: expect.any(String),
    });

    const oldTokenResponse = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
      },
    });
    expect(oldTokenResponse.status).toBe(401);

    const newTokenResponse = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer test-observability-rotated-token',
        Accept: 'application/json',
      },
    });
    const newTokenPayload = await newTokenResponse.json();

    expect(newTokenResponse.status).toBe(200);
    expect(newTokenPayload.requests.total).toBe(1);

    await stopServer();
    await startServerWithSqlitePath(sqlitePath);

    const persistedOldTokenResponse = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
      },
    });
    expect(persistedOldTokenResponse.status).toBe(401);

    const persistedNewTokenResponse = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer test-observability-rotated-token',
        Accept: 'application/json',
      },
    });
    expect(persistedNewTokenResponse.status).toBe(200);
  });

  it('includes live sink diagnostics when available', async () => {
    const diagnosticsSink: ObservabilitySink = {
      recordRequest: () => undefined,
      recordEvent: () => undefined,
      getDiagnostics: () => ({
        otlp: {
          queueDepth: 0,
          queueCapacity: 5,
          dropPolicy: 'oldest',
          inFlight: false,
          successfulExports: 2,
          failedExports: 1,
          exportedLogRecords: 10,
          droppedLogRecords: 3,
          droppedOverflowLogRecords: 1,
          droppedFailedExportLogRecords: 2,
          retryCount: 4,
          lastErrorAt: '2026-05-18T00:10:00.000Z',
          lastErrorMessage: 'OTLP logs export failed with status 503.',
          lastSuccessAt: '2026-05-18T00:09:00.000Z',
        },
      }),
    };

    await startServer({ seedData: true, observabilitySink: diagnosticsSink });

    const response = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sinks.otlp).toMatchObject({
      queueDepth: 0,
      queueCapacity: 5,
      dropPolicy: 'oldest',
      inFlight: false,
      successfulExports: 2,
      failedExports: 1,
      exportedLogRecords: 10,
      droppedLogRecords: 3,
      droppedOverflowLogRecords: 1,
      droppedFailedExportLogRecords: 2,
      retryCount: 4,
      lastErrorAt: '2026-05-18T00:10:00.000Z',
      lastErrorMessage: 'OTLP logs export failed with status 503.',
      lastSuccessAt: '2026-05-18T00:09:00.000Z',
    });
  });

  it('merges persisted OTLP history from sqlite with live sink diagnostics', async () => {
    const diagnosticsSink: ObservabilitySink = {
      recordRequest: () => undefined,
      recordEvent: () => undefined,
      getDiagnostics: () => ({
        otlp: {
          queueDepth: 1,
          queueCapacity: 4,
          dropPolicy: 'oldest',
          inFlight: false,
          successfulExports: 3,
          failedExports: 1,
          exportedLogRecords: 12,
          droppedLogRecords: 1,
          droppedOverflowLogRecords: 1,
          droppedFailedExportLogRecords: 0,
          retryCount: 2,
          lastErrorAt: '2026-05-18T00:10:00.000Z',
          lastErrorMessage: 'OTLP logs export failed with status 503.',
          lastSuccessAt: '2026-05-18T00:09:00.000Z',
        },
      }),
    };

    await startServer({ seedData: true, seedOtlpHistory: true, observabilitySink: diagnosticsSink });

    const response = await fetch(`${baseUrl}/api/observability/summary`, {
      headers: {
        Authorization: 'Bearer summary-secret',
        Accept: 'application/json',
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sinks.otlp).toMatchObject({
      queueDepth: 1,
      queueCapacity: 4,
      dropPolicy: 'oldest',
      successfulExports: 3,
      droppedLogRecords: 1,
    });
    expect(payload.sinks.otlp.history.samples.length).toBeGreaterThan(0);
    expect(payload.sinks.otlp.history.samples.at(-1)).toMatchObject({
      queueCapacity: 3,
      dropPolicy: 'oldest',
      successfulExports: 1,
      droppedOverflowLogRecords: 1,
    });
  });

  async function startServer(options: { seedData?: boolean; seedOtlpHistory?: boolean; observabilitySink?: ObservabilitySink } = {}) {
    tempDirectory = mkdtempSync(join(tmpdir(), 'resume-observability-summary-'));
    const sqlitePath = join(tempDirectory, 'observability.sqlite');
    const occurredBaseMs = Date.now() - (15 * 60 * 1_000);

    if (options.seedData) {
      const sink = createSqliteObservabilitySink(sqlitePath);
      const observations = [
        { routeId: 'health', statusCode: 200, durationMs: 10, ipHash: 'ip-hash-a', errorCode: null },
        { routeId: 'health', statusCode: 200, durationMs: 20, ipHash: 'ip-hash-a', errorCode: null },
        { routeId: 'render_typst', statusCode: 400, durationMs: 30, ipHash: 'ip-hash-a', errorCode: 'VALIDATION_ERROR' },
        { routeId: 'render_typst', statusCode: 400, durationMs: 40, ipHash: 'ip-hash-a', errorCode: 'VALIDATION_ERROR' },
        { routeId: 'intake_text', statusCode: 429, durationMs: 100, ipHash: 'ip-hash-b', errorCode: 'QUOTA_EXCEEDED' },
      ] as const;

      observations.forEach((observation, index) => {
        sink.recordRequest({
          occurredAt: new Date(occurredBaseMs + (index * 60_000)).toISOString(),
          requestId: `request-${index + 1}`,
          routeId: observation.routeId,
          method: observation.routeId === 'health' ? 'GET' : 'POST',
          statusCode: observation.statusCode,
          durationMs: observation.durationMs,
          requestBytes: observation.routeId === 'health' ? null : 128,
          responseBytes: 256,
          origin: 'http://localhost:5173',
          contentType: 'application/json',
          ipHash: observation.ipHash,
          networkHash: `${observation.ipHash}-network`,
          userAgentFamily: 'node',
          errorCode: observation.errorCode,
        });
      });

      sink.recordEvent({
        occurredAt: new Date(occurredBaseMs + (5 * 60_000)).toISOString(),
        requestId: 'request-3',
        routeId: 'render_typst',
        eventName: 'render_failed',
        payload: {
          errorCode: 'VALIDATION_ERROR',
        },
      });
      sink.recordEvent({
        occurredAt: new Date(occurredBaseMs + (6 * 60_000)).toISOString(),
        requestId: 'request-4',
        routeId: 'render_typst',
        eventName: 'render_failed',
        payload: {
          errorCode: 'VALIDATION_ERROR',
        },
      });
      sink.recordEvent({
        occurredAt: new Date(occurredBaseMs + (7 * 60_000)).toISOString(),
        requestId: 'request-5',
        routeId: 'intake_text',
        eventName: 'quota_exceeded',
        payload: {
          limit: 1,
        },
      });
      sink.close?.();
    }

    if (options.seedOtlpHistory) {
      const otlpSink = createOtlpHttpJsonObservabilitySink({
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
        maxQueueSize: 3,
        dropPolicy: 'oldest',
      });

      otlpSink.recordRequest({
        occurredAt: new Date(occurredBaseMs + (8 * 60_000)).toISOString(),
        requestId: 'otlp-1',
        routeId: 'render_typst',
        method: 'POST',
        statusCode: 200,
        durationMs: 42,
        requestBytes: 128,
        responseBytes: 256,
        origin: 'http://localhost:5173',
        contentType: 'application/json',
        ipHash: 'otlp-ip-1',
        networkHash: 'otlp-network-1',
        userAgentFamily: 'node',
        errorCode: null,
      });
      otlpSink.recordRequest({
        occurredAt: new Date(occurredBaseMs + (9 * 60_000)).toISOString(),
        requestId: 'otlp-2',
        routeId: 'render_typst',
        method: 'POST',
        statusCode: 200,
        durationMs: 52,
        requestBytes: 128,
        responseBytes: 256,
        origin: 'http://localhost:5173',
        contentType: 'application/json',
        ipHash: 'otlp-ip-2',
        networkHash: 'otlp-network-2',
        userAgentFamily: 'node',
        errorCode: null,
      });
      otlpSink.recordRequest({
        occurredAt: new Date(occurredBaseMs + (10 * 60_000)).toISOString(),
        requestId: 'otlp-3',
        routeId: 'render_typst',
        method: 'POST',
        statusCode: 200,
        durationMs: 62,
        requestBytes: 128,
        responseBytes: 256,
        origin: 'http://localhost:5173',
        contentType: 'application/json',
        ipHash: 'otlp-ip-3',
        networkHash: 'otlp-network-3',
        userAgentFamily: 'node',
        errorCode: null,
      });
      otlpSink.recordRequest({
        occurredAt: new Date(occurredBaseMs + (11 * 60_000)).toISOString(),
        requestId: 'otlp-4',
        routeId: 'render_typst',
        method: 'POST',
        statusCode: 200,
        durationMs: 72,
        requestBytes: 128,
        responseBytes: 256,
        origin: 'http://localhost:5173',
        contentType: 'application/json',
        ipHash: 'otlp-ip-4',
        networkHash: 'otlp-network-4',
        userAgentFamily: 'node',
        errorCode: null,
      });
      await otlpSink.close?.();
    }

    app = createApp({
      observabilityConfig: {
        enabled: true,
        sink: 'sqlite',
        sqlitePath,
        hmacSecret: 'summary-test-secret',
        trustProxy: false,
        debug: false,
        summaryEnabled: true,
        summaryToken: 'summary-secret',
        summaryDefaultWindowHours: 24,
      },
      observabilitySink: options.observabilitySink,
    });
    server = createServer(app);

    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function startServerWithSqlitePath(sqlitePath: string, observabilitySink?: ObservabilitySink) {
    app = createApp({
      observabilityConfig: {
        enabled: true,
        sink: 'sqlite',
        sqlitePath,
        hmacSecret: 'summary-test-secret',
        trustProxy: false,
        debug: false,
        summaryEnabled: true,
        summaryToken: 'summary-secret',
        summaryDefaultWindowHours: 24,
      },
      observabilitySink,
    });
    server = createServer(app);

    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function stopServer() {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
      });
    }

    await app?.close();
    server = undefined;
    app = undefined;
    baseUrl = '';
  }
});