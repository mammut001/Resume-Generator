import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('static asset caching', () => {
  let server: Server | undefined;
  let baseUrl = '';
  let tempDirectory: string | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close(error => (error ? reject(error) : resolve()));
      });
    }

    if (tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
    }

    server = undefined;
    baseUrl = '';
    tempDirectory = undefined;
  });

  it('uses immutable caching only for fingerprinted build assets', async () => {
    await startServer();

    const [indexResponse, previewResponse, assetResponse] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/template-previews/basic-resume.svg?v=20260519-1`),
      fetch(`${baseUrl}/assets/index-DOaeUtR4.js`),
    ]);

    expect(indexResponse.headers.get('cache-control')).toBe('no-cache');
    expect(previewResponse.headers.get('cache-control')).toBe('public, max-age=300');
    expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  async function startServer() {
    tempDirectory = mkdtempSync(join(tmpdir(), 'resume-static-assets-'));
    mkdirSync(join(tempDirectory, 'assets'), { recursive: true });
    mkdirSync(join(tempDirectory, 'template-previews'), { recursive: true });

    writeFileSync(join(tempDirectory, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
    writeFileSync(join(tempDirectory, 'template-previews', 'basic-resume.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>');
    writeFileSync(join(tempDirectory, 'assets', 'index-DOaeUtR4.js'), 'console.log("ok")');

    server = createServer(createApp({ staticDir: tempDirectory }));

    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});