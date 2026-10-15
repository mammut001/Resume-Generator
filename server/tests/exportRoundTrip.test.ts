import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { ResumeData } from '@/types/resume';
import { createApp } from '../src/app.js';
import { compileTypst } from '../src/services/typstService.js';

const typstAvailable = spawnSync('typst', ['--version'], { encoding: 'utf8' }).status === 0;

describe('exported PDF round trip', () => {
  let server: Server | undefined;
  let baseUrl = '';

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server?.close(error => (error ? reject(error) : resolve()));
    });
    server = undefined;
    baseUrl = '';
  });

  it.skipIf(!typstAvailable)('preserves an English clean-professional export through /api/intake/pdf', async () => {
    const source = getDefaultResume('en');
    const imported = await roundTrip(source, 'en');
    expectRoundTrip(source, imported, ' in ');
  }, 60_000);

  it.skipIf(!typstAvailable)('preserves a Chinese clean-professional export through /api/intake/pdf', async () => {
    const source = getDefaultResume('zh-CN');
    const imported = await roundTrip(source, 'zh-CN');
    expectRoundTrip(source, imported, '，');
    expect(imported.design.pageSize).toBe('a4');
  }, 60_000);

  async function roundTrip(resume: ResumeData, locale: 'en' | 'zh-CN'): Promise<ResumeData> {
    const source = renderResumeToTypst(resume, 'clean-professional', locale);
    const pdf = await compileTypst({ source, format: 'pdf' }, { timeoutMs: 60_000 });
    await startServer();

    const formData = new FormData();
    formData.set('file', new File([pdf], `${locale}-resume.pdf`, { type: 'application/pdf' }));
    const response = await fetch(`${baseUrl}/api/intake/pdf`, { method: 'POST', body: formData });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.kind).toBe('draft');
    return payload.draft.resume as ResumeData;
  }

  async function startServer() {
    server = createServer(createApp());
    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

function expectRoundTrip(source: ResumeData, imported: ResumeData, degreeConnector: string) {
  expect(imported.personal.fullName).toBe(source.personal.fullName);
  expect(imported.personal.headline).toBe(source.personal.headline);
  expect(imported.personal.email).toBe(source.personal.email);
  expect(imported.personal.phone).toBe(source.personal.phone);
  expect(imported.personal.location).toBe(source.personal.location);
  expect(imported.personal.website).toBe(source.personal.website);
  expect(imported.personal.linkedin).toBe(source.personal.linkedin);
  expect(imported.personal.github).toBe(source.personal.github);
  expect(imported.summary).toBe(source.summary);

  expect(imported.experience.map(entry => ({
    company: entry.company,
    role: entry.role,
    location: entry.location || '',
    startDate: entry.startDate,
    endDate: entry.endDate,
    current: Boolean(entry.current),
    bullets: entry.bullets,
  }))).toEqual(source.experience.map(entry => ({
    company: entry.company,
    role: entry.role,
    location: entry.location || '',
    startDate: entry.startDate,
    endDate: entry.endDate,
    current: Boolean(entry.current),
    bullets: entry.bullets,
  })));

  expect(imported.education.map(entry => ({
    school: entry.school,
    degree: `${entry.degree}${entry.field ? `${degreeConnector}${entry.field}` : ''}`,
    location: entry.location || '',
    startDate: entry.startDate || '',
    endDate: entry.endDate || '',
  }))).toEqual(source.education.map(entry => ({
    school: entry.school,
    degree: `${entry.degree}${entry.field ? `${degreeConnector}${entry.field}` : ''}`,
    location: entry.location || '',
    startDate: entry.startDate || '',
    endDate: entry.endDate || '',
  })));

  expect(imported.skills.map(group => ({ category: group.category, items: group.items }))).toEqual(
    source.skills.map(group => ({ category: group.category, items: group.items })),
  );

  expect(imported.projects.map(project => ({
    name: project.name,
    url: project.url || '',
    narrative: [project.description, ...project.bullets].map(line => line.trim()).filter(Boolean),
  }))).toEqual(source.projects.map(project => ({
    name: project.name,
    url: project.url || '',
    narrative: [project.description, ...project.bullets].map(line => line.trim()).filter(Boolean),
  })));
}
