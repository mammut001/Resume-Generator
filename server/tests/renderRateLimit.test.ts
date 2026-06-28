import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('render typst rate limiting', () => {
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;
  });

  it('returns 429 after exceeding the per-minute render limit', async () => {
    server = createServer(createApp({ renderRateLimitPerMinute: 1 }));
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
    const address = server!.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const body = { source: '#set page(paper: "a4")\nHello', format: 'svg' };
    const first = await fetch(`${baseUrl}/api/render/typst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/render/typst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(429);
  });
});