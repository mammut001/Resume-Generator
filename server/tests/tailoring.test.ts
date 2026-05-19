import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, RenderServerOptions } from '../src/app';
import type { ResumeData } from '../src/intake/types';
import type { ResumeTailoringResult } from '../src/tailoring/types';

const jobDescription = 'Title: Frontend Platform Engineer. We need React, TypeScript, accessibility, design systems, Playwright testing, and Kubernetes experience for a platform team.';

describe('resume tailoring API', () => {
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

  it('reports separate tailoring usage', async () => {
    await startServer({ tailoringAttemptLimit: 3, intakeAttemptLimit: 1 });

    const response = await fetch(`${baseUrl}/api/tailor/usage`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ remainingAttempts: 3, limit: 3, resetAt: null });
  });

  it('rejects missing or too-short job descriptions', async () => {
    await startServer();

    const response = await postTailoring({ resume: sourceResume, jobDescription: 'too short' });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe('TAILORING_NO_JOB_DESCRIPTION');
  });

  it('returns a valid structured local tailoring result when the gateway is not configured', async () => {
    await startServer();

    const response = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await response.json() as ResumeTailoringResult;

    expect(response.status).toBe(200);
    expect(payload.tailoredResume.summary).toContain('Frontend Platform Engineer');
    expect(payload.summary.keyRequirements).toContain('React');
    expect(payload.summary.matchedStrengths).toContain('React');
    expect(payload.summary.gaps).toContain('Kubernetes');
    expect(payload.changes.some(change => change.section === 'summary')).toBe(true);
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_MODEL_GATEWAY_NOT_CONFIGURED');
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_GAP');
  });

  it('preserves source facts and removes unsupported model inventions', async () => {
    const fetchImpl: typeof fetch = async () => modelResponse(JSON.stringify(modelTailoringResult({
      tailoredResume: {
        ...sourceResume,
        experience: [
          ...sourceResume.experience,
          {
            id: 'fake-exp',
            company: 'FakeCorp',
            role: 'Kubernetes Architect',
            startDate: '2025',
            endDate: '',
            bullets: ['Invented Kubernetes migration that improved uptime by 99%.'],
          },
        ],
        education: [
          ...sourceResume.education,
          { id: 'fake-edu', school: 'Fake Academy', degree: 'MBA' },
        ],
        skills: [
          { id: 'skill-1', category: 'Core', items: ['Kubernetes', 'React', 'TypeScript'] },
        ],
      },
    })));

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await response.json() as ResumeTailoringResult;
    const serializedResume = JSON.stringify(payload.tailoredResume);

    expect(response.status).toBe(200);
    expect(serializedResume).not.toContain('FakeCorp');
    expect(serializedResume).not.toContain('Fake Academy');
    expect(serializedResume).not.toContain('Kubernetes Architect');
    expect(payload.tailoredResume.skills.flatMap(group => group.items)).not.toContain('Kubernetes');
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_UNSUPPORTED_FACT_REMOVED');
  });

  it('repairs malformed model JSON once', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;
      return modelResponse(callCount === 1 ? '{not json' : JSON.stringify(modelTailoringResult()));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await response.json() as ResumeTailoringResult;

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_OUTPUT_REPAIRED');
  });

  it('repairs schema-invalid model output once', async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount += 1;
      return modelResponse(JSON.stringify(callCount === 1 ? { tailoredResume: sourceResume } : modelTailoringResult()));
    };

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await response.json() as ResumeTailoringResult;

    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_OUTPUT_REPAIRED');
  });

  it('falls back safely after repeated model output failures', async () => {
    const fetchImpl: typeof fetch = async () => modelResponse('{still not json');

    await startServer({
      modelGatewayConfig: {
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
        fetchImpl,
      },
    });

    const response = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await response.json() as ResumeTailoringResult;

    expect(response.status).toBe(200);
    expect(payload.tailoredResume.experience).toHaveLength(sourceResume.experience.length);
    expect(payload.warnings.map(warning => warning.code)).toContain('TAILORING_MODEL_GATEWAY_FAILED');
  });

  it('enforces the separate tailoring quota', async () => {
    await startServer({ tailoringAttemptLimit: 1 });

    const firstResponse = await postTailoring({ resume: sourceResume, jobDescription });
    expect(firstResponse.status).toBe(200);

    const secondResponse = await postTailoring({ resume: sourceResume, jobDescription });
    const payload = await secondResponse.json();

    expect(secondResponse.status).toBe(429);
    expect(payload.error.code).toBe('QUOTA_EXCEEDED');
  });

  async function startServer(options: RenderServerOptions = {}) {
    server = createServer(createApp(options));
    await new Promise<void>(resolve => server?.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function postTailoring(payload: unknown) {
    return fetch(`${baseUrl}/api/tailor/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }
});

const sourceResume: ResumeData = {
  id: 'resume-source',
  title: 'Frontend Engineer Resume',
  templateId: 'modern-compact',
  design: {
    typography: 'sans',
    density: 'comfortable',
    pageSize: 'letter',
    accentColor: '#0f766e',
  },
  personal: {
    fullName: 'Jordan Lee',
    headline: 'Frontend Engineer',
    email: 'jordan@example.com',
    phone: '+1 555 0100',
    location: 'San Francisco, CA',
    website: 'jordan.dev',
  },
  summary: 'Frontend engineer with experience building design systems, accessible interfaces, and performant React applications.',
  experience: [
    {
      id: 'exp-1',
      company: 'TechCorp',
      role: 'Senior Frontend Engineer',
      location: 'San Francisco, CA',
      startDate: '2022',
      endDate: '',
      current: true,
      bullets: [
        'Led React and TypeScript architecture for a shared design system used by three product teams.',
        'Improved accessibility across core flows and mentored engineers on inclusive UI patterns.',
        'Reduced frontend bundle size by 30% through performance profiling.',
      ],
    },
  ],
  education: [
    {
      id: 'edu-1',
      school: 'UC Berkeley',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
    },
  ],
  skills: [
    {
      id: 'skill-1',
      category: 'Core',
      items: ['React', 'TypeScript', 'Accessibility', 'Design Systems', 'Performance'],
    },
  ],
  projects: [],
};

function modelTailoringResult(overrides: Partial<ResumeTailoringResult> = {}): ResumeTailoringResult {
  return {
    tailoredResume: {
      ...sourceResume,
      id: 'tailored-source',
      title: 'Frontend Resume - Tailored for Platform Engineer',
      summary: 'Frontend engineer focused on platform roles with React, TypeScript, accessibility, and design-system experience.',
      experience: [{
        ...sourceResume.experience[0],
        bullets: [
          'Led React and TypeScript architecture for a shared design system used by three product teams.',
          'Improved accessibility across core flows and mentored engineers on inclusive UI patterns.',
        ],
      }],
      skills: [{
        ...sourceResume.skills[0],
        items: ['TypeScript', 'React', 'Accessibility', 'Design Systems', 'Performance'],
      }],
    },
    summary: {
      targetRole: 'Frontend Platform Engineer',
      keyRequirements: ['React', 'TypeScript', 'Accessibility', 'Kubernetes'],
      matchedStrengths: ['React', 'TypeScript', 'Accessibility'],
      gaps: ['Kubernetes'],
    },
    changes: [{
      id: 'change-summary',
      section: 'summary',
      kind: 'rewritten',
      description: 'Rewrote summary toward Frontend Platform Engineer.',
      before: sourceResume.summary,
      after: 'Frontend engineer focused on platform roles with React, TypeScript, accessibility, and design-system experience.',
    }],
    warnings: [],
    ...overrides,
  };
}

function modelResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}