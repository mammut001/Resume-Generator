import { spawnSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { defaultResume } from '../../src/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '../../src/features/resume-generator/data/resumeTemplates';

const typstBin = process.env.TYPST_BIN || 'typst';
const typstAvailable = spawnSync(typstBin, ['--version'], { encoding: 'utf8' }).status === 0;

describe('Typst render API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(createApp({ typstBin, timeoutMs: 10_000, maxBodyBytes: 32 * 1024 }));

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  it('rejects invalid parameters with structured errors', async () => {
    const response = await postRender({ source: 'Hello', format: 'docx' });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('format');
  });

  it.skipIf(!typstAvailable)('renders svg output', async () => {
    const response = await postRender({ source: '#set page(width: 3in, height: 2in)\nHello from test', format: 'svg' });
    const output = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(output).toContain('<svg');
  });

  it.skipIf(!typstAvailable)('renders pdf output', async () => {
    const response = await postRender({ source: '#set page(width: 3in, height: 2in)\nHello from test', format: 'pdf' });
    const output = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(output.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it.skipIf(!typstAvailable)('returns structured errors for invalid Typst source', async () => {
    const response = await postRender({ source: '#let =', format: 'svg' });
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe('TYPST_COMPILE_ERROR');
    expect(payload.error.message).toBe('Typst compilation failed.');
    expect(payload.error.details).toBeTruthy();
    expect(payload.error.details).not.toContain('/resume-generator-');
  });

  it.skipIf(!typstAvailable)('renders generated resume source', async () => {
    const source = renderResumeToTypst(defaultResume, defaultResume.templateId);
    const response = await postRender({ source, format: 'svg' });
    const output = await response.text();

    expect(response.status).toBe(200);
    expect(output).toContain('<svg');
  });

  function postRender(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/render/typst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
});