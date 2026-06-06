import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, RenderApp } from '../src/app';
import { createAnalyticsRoute } from '../src/routes/analytics';

type ServerHandle = { app: RenderApp; server: Server; baseUrl: string };

async function startServer(options: { databasePath?: string; rateLimitPerMinute?: number; now?: () => number; summaryToken?: string; hmacSecret?: string } = {}): Promise<ServerHandle> {
  const summaryToken = options.summaryToken ?? 'analytics-secret';
  const app = createApp({
    analyticsOptions: {
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: options.rateLimitPerMinute } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.hmacSecret ? { hmacSecret: options.hmacSecret } : {}),
      isAuthorized: token => token === summaryToken,
    },
    allowedOrigin: '*',
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { app, server, baseUrl: `http://127.0.0.1:${port}` };
}



describe('analytics route', () => {
  let tempDirectory: string | undefined;
  let handle: ServerHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await new Promise<void>((resolve, reject) => handle?.server.close(error => (error ? reject(error) : resolve())));
      await handle.app.close();
      handle = undefined;
    }
    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  });

  it('accepts an allowlisted event, sanitizes payload, and rejects unknown events', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'analytics-route-'));
    const now = () => Date.parse('2026-05-20T10:00:00.000Z');
    handle = await startServer({ databasePath: join(tempDirectory, 'analytics.sqlite'), now, summaryToken: 't0k' });

    const ok = await fetch(`${handle.baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'export_completed',
        payload: {
          format: 'pdf',
          resumeText: 'should be stripped',
          jobDescription: 'should be stripped',
          issueCount: 0,
          long: 'a'.repeat(200),
        },
        occurredAt: '2026-05-20T10:00:00.000Z',
      }),
    });
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ accepted: true, event: 'export_completed' });

    const denied = await fetch(`${handle.baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'not_a_real_event', payload: {} }),
    });
    expect(denied.status).toBe(400);
    const deniedBody = await denied.json();
    expect(deniedBody.error.code).toBe('VALIDATION_ERROR');

    const badMethod = await fetch(`${handle.baseUrl}/api/analytics/event`, { method: 'GET' });
    expect(badMethod.status).toBe(405);

    const summary = await fetch(`${handle.baseUrl}/api/analytics/summary`, { headers: { Authorization: 'Bearer t0k' } });
    const summaryBody = await summary.json();
    expect(summary.status).toBe(200);
    expect(summaryBody.enabled).toBe(true);
    expect(summaryBody.totalEvents).toBe(1);
    expect(summaryBody.topEvents[0]).toEqual({ event: 'export_completed', count: 1 });
    expect(summaryBody.topEvents[0].count).toBe(1);
    // Sensitive keys stripped, long string truncated, but the shape survives.
    const top = summaryBody.topEvents[0];
    expect(top).toMatchObject({ event: 'export_completed', count: 1 });
  });

  it('requires the summary token and returns 401 without it', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'analytics-route-'));
    handle = await startServer({ databasePath: join(tempDirectory, 'analytics.sqlite'), summaryToken: 't0k' });

    const missing = await fetch(`${handle.baseUrl}/api/analytics/summary`);
    expect(missing.status).toBe(401);
    const missingBody = await missing.json();
    expect(missingBody.error.code).toBe('UNAUTHORIZED');

    const wrong = await fetch(`${handle.baseUrl}/api/analytics/summary`, { headers: { Authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);

    const right = await fetch(`${handle.baseUrl}/api/analytics/summary`, { headers: { Authorization: 'Bearer t0k' } });
    expect(right.status).toBe(200);
  });

  it('rate-limits a single IP once the per-minute threshold is exceeded', async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'analytics-route-'));
    const now = () => Date.parse('2026-05-20T11:00:00.000Z');
    handle = await startServer({ databasePath: join(tempDirectory, 'analytics.sqlite'), now, rateLimitPerMinute: 3, summaryToken: 't0k' });

    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${handle.baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
        body: JSON.stringify({ event: 'page_viewed', payload: { path: `/p${i}` } }),
      });
      expect(r.status).toBe(202);
    }

    const blocked = await fetch(`${handle.baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
      body: JSON.stringify({ event: 'page_viewed', payload: { path: '/p4' } }),
    });
    expect(blocked.status).toBe(429);
    const blockedBody = await blocked.json();
    expect(blockedBody.error.code).toBe('QUOTA_EXCEEDED');

    const summary = await fetch(`${handle.baseUrl}/api/analytics/summary`, { headers: { Authorization: 'Bearer t0k' } });
    const summaryBody = await summary.json();
    expect(summaryBody.totalEvents).toBe(3);
  });

  it('reports reason and in-memory totals when no sqlite path is configured', async () => {
    handle = await startServer({ summaryToken: 't0k' });

    const r = await fetch(`${handle.baseUrl}/api/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_viewed', payload: { path: '/' } }),
    });
    expect(r.status).toBe(202);

    const summary = await fetch(`${handle.baseUrl}/api/analytics/summary`, { headers: { Authorization: 'Bearer t0k' } });
    const summaryBody = await summary.json();
    expect(summaryBody.enabled).toBe(false);
    expect(summaryBody.reason).toContain('in-memory');
    expect(summaryBody.totalEvents).toBe(1);
  });

});
