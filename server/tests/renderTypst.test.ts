import { spawnSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { defaultResume, getDefaultResume } from '../../src/features/resume-generator/data/defaultResume';
import { extractTextFromPdfBuffer } from '../src/intake/pdfIntake';
import { compileTypst } from '../src/services/typstService';
import { renderResumeToTypst, resumeTemplates } from '../../src/features/resume-generator/data/resumeTemplates';

const typstBin = process.env.TYPST_BIN || 'typst';
const typstAvailable = spawnSync(typstBin, ['--version'], { encoding: 'utf8' }).status === 0;

describe('Typst render API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(createApp({ typstBin, timeoutMs: 30_000, maxBodyBytes: 32 * 1024 }));

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

  it.skipIf(!typstAvailable)('compiles user text that contains Typst markup characters', async () => {
    const poison = 'dev@ex.com #tag $math *bold* _em_ <lab> [br] \\slash `tick`';
    const resume = {
      ...defaultResume,
      personal: {
        ...defaultResume.personal,
        headline: poison,
        email: 'dev@ex.com',
      },
      summary: poison,
      experience: [{
        ...defaultResume.experience[0],
        role: poison,
        company: 'Acme @HQ',
        bullets: [poison],
      }],
      skills: [{ id: 'skill-poison', category: 'Tools', items: [poison] }],
      projects: [{
        id: 'proj-poison',
        name: 'Kit',
        description: poison,
        bullets: [poison],
      }],
    };

    for (const template of resumeTemplates) {
      const source = renderResumeToTypst(resume, template.id, 'en');
      const response = await postRender({ source, format: 'svg' });
      const output = await response.text();
      expect(response.status, `${template.id}: ${output}`).toBe(200);
      expect(output).toContain('<svg');
    }
  }, 60_000);

  it.skipIf(!typstAvailable)('renders generated resume source', async () => {
    const source = renderResumeToTypst(defaultResume, defaultResume.templateId);
    const response = await postRender({ source, format: 'svg' });
    const output = await response.text();

    expect(response.status).toBe(200);
    expect(output).toContain('<svg');
  });

  it.skipIf(!typstAvailable)('prints brilliant-cv summary without brackets and keeps each job bullet separate', async () => {
    const source = renderResumeToTypst(defaultResume, 'brilliant-cv', 'en');
    const pdf = await compileTypst({ source, format: 'pdf' }, { timeoutMs: 60_000 });
    const extracted = await extractTextFromPdfBuffer(pdf);

    expect(extracted.text).toContain('Frontend engineer with 5+ years');
    expect(extracted.text).not.toContain('[Frontend engineer');
    expect(extracted.text).not.toContain('millions.]');
    expect(extracted.text).toContain('Led frontend architecture');
    expect(extracted.text).toContain('Mentored 4 junior engineers');
    expect(extracted.text).toContain('Built a reusable component library');
    expect(extracted.text).toMatch(/30%\.\s*\n\s*• Mentored 4 junior engineers/);
    expect(extracted.text).toMatch(/team\.\s*\n\s*• Built a reusable component library/);
    expect(extracted.text).not.toMatch(/30%\. • Mentored/);
  }, 60_000);

  it.skipIf(!typstAvailable)('renders generated Chinese resume source for all visible templates', async () => {
    const zhResume = getDefaultResume('zh-CN');

    for (const template of resumeTemplates) {
      const source = renderResumeToTypst(zhResume, template.id, 'zh-CN');
      const response = await postRender({ source, format: 'svg' });
      const output = await response.text();

      expect(response.status, `${template.id}: ${output}`).toBe(200);
      expect(output).toContain('<svg');
    }
  }, 40_000);

  function postRender(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/render/typst`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
});
