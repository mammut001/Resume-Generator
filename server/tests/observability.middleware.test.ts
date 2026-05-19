import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { DomainEvent, ObservabilitySink, RequestObservation } from '../src/observability/types';

describe('observability middleware', () => {
  let server: Server | undefined;
  let baseUrl = '';
  let requestObservations: RequestObservation[] = [];
  let domainEvents: DomainEvent[] = [];

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
      });
    }

    server = undefined;
    baseUrl = '';
    requestObservations = [];
    domainEvents = [];
  });

  it('adds request IDs and records request observations for successful routes', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/health`);
    const requestId = response.headers.get('x-request-id');

    expect(response.status).toBe(200);
    expect(requestId).toBeTruthy();
    expect(requestObservations).toHaveLength(1);
    expect(requestObservations[0]).toMatchObject({
      requestId,
      routeId: 'health',
      statusCode: 200,
      method: 'GET',
      errorCode: null,
    });
    expect(requestObservations[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(requestObservations[0].responseBytes).toBeGreaterThan(0);
    expect(requestObservations[0].ipHash).toBeTruthy();
    expect(requestObservations[0].networkHash).toBeTruthy();
  });

  it('extracts structured error codes without recording request body content', async () => {
    await startServer();

    const secretText = 'secret text';
    const response = await fetch(`${baseUrl}/api/intake/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ text: secretText }),
    });
    const payload = await response.json();
    const observation = requestObservations[0];

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(observation.routeId).toBe('intake_text');
    expect(observation.errorCode).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(observation)).not.toContain(secretText);
  });

  it('marks unknown routes as not_found', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/unknown`);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe('NOT_FOUND');
    expect(requestObservations[0]).toMatchObject({
      routeId: 'not_found',
      errorCode: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('records render failure domain events', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/render/typst`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ source: 'Hello', format: 'docx' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(requestObservations[0]).toMatchObject({
      routeId: 'render_typst',
      errorCode: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(domainEvents).toHaveLength(1);
    expect(domainEvents[0]).toMatchObject({
      routeId: 'render_typst',
      eventName: 'render_failed',
      payload: {
        errorCode: 'VALIDATION_ERROR',
      },
    });
  });

  async function startServer() {
    const sink: ObservabilitySink = {
      recordRequest: observation => {
        requestObservations.push(observation);
      },
      recordEvent: event => {
        domainEvents.push(event);
      },
    };

    server = createServer(createApp({
      observabilityConfig: {
        enabled: true,
        sink: 'noop',
        hmacSecret: 'test-observability-secret',
        trustProxy: false,
        debug: false,
      },
      observabilitySink: sink,
    }));

    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});