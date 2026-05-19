import { describe, expect, it } from 'vitest';
import { createStdoutObservabilitySink } from '../src/observability/stdoutSink';

describe('stdout observability sink', () => {
  it('writes JSON envelopes for request observations', () => {
    const lines: string[] = [];
    const sink = createStdoutObservabilitySink(line => lines.push(line));

    sink.recordRequest({
      occurredAt: '2026-05-18T00:00:00.000Z',
      requestId: 'request-1',
      routeId: 'health',
      method: 'GET',
      statusCode: 200,
      durationMs: 4,
      requestBytes: null,
      responseBytes: 11,
      origin: null,
      contentType: 'application/json; charset=utf-8',
      ipHash: 'hash-1',
      networkHash: 'network-1',
      userAgentFamily: 'node',
      errorCode: null,
    });

    expect(JSON.parse(lines[0])).toEqual({
      kind: 'request_observation',
      record: {
        occurredAt: '2026-05-18T00:00:00.000Z',
        requestId: 'request-1',
        routeId: 'health',
        method: 'GET',
        statusCode: 200,
        durationMs: 4,
        requestBytes: null,
        responseBytes: 11,
        origin: null,
        contentType: 'application/json; charset=utf-8',
        ipHash: 'hash-1',
        networkHash: 'network-1',
        userAgentFamily: 'node',
        errorCode: null,
      },
    });
  });
});