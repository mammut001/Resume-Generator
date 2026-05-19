import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteObservabilitySink } from '../src/observability/sqliteSink';

describe('sqlite observability sink', () => {
  let tempDirectory: string | undefined;

  afterEach(() => {
    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  });

  it('persists request observations and domain events', () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'resume-observability-'));
    const sqlitePath = join(tempDirectory, 'observability.sqlite');
    const sink = createSqliteObservabilitySink(sqlitePath);

    sink.recordRequest({
      occurredAt: '2026-05-18T00:00:00.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      method: 'POST',
      statusCode: 200,
      durationMs: 42,
      requestBytes: 128,
      responseBytes: 512,
      origin: 'http://localhost:5173',
      contentType: 'application/json',
      ipHash: 'ip-hash',
      networkHash: 'network-hash',
      userAgentFamily: 'node',
      errorCode: null,
    });
    sink.recordEvent({
      occurredAt: '2026-05-18T00:00:01.000Z',
      requestId: 'request-1',
      routeId: 'render_typst',
      eventName: 'render_completed',
      payload: {
        format: 'pdf',
        durationMs: 42,
      },
    });

    const db = new DatabaseSync(sqlitePath);
    const requestRows = db.prepare('select route_id, status_code from request_observations').all() as Array<{ route_id: string; status_code: number }>;
    const eventRows = db.prepare('select event_name, payload_json from domain_events').all() as Array<{ event_name: string; payload_json: string }>;

    expect(requestRows).toEqual([{ route_id: 'render_typst', status_code: 200 }]);
    expect(eventRows).toEqual([{ event_name: 'render_completed', payload_json: JSON.stringify({ format: 'pdf', durationMs: 42 }) }]);

    db.close();
    sink.close?.();
  });
});