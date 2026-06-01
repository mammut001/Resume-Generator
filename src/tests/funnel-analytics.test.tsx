// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportSection, StartIntakeSection } from '@/features/resume-generator/components/ResumeEditorPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';
import type { ResumeIntakeResult } from '@/types/resume';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: trackMock,
  sanitizeAnalyticsPayload: (payload: Record<string, unknown>) => payload,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/features/resume-generator/lib/resumeIntake', () => ({
  getIntakeUsage: vi.fn().mockResolvedValue({ remainingAttempts: 3, limit: 5, resetAt: null }),
  generateResumeFromText: vi.fn(),
  generateResumeFromPdf: vi.fn(),
}));

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypstToPdf: vi.fn().mockResolvedValue({ ok: true, pdfBlob: new Blob(['pdf']) }),
  renderTypst: vi.fn().mockResolvedValue({ ok: true, svgHtml: '<svg></svg>' }),
}));

vi.mock('@/features/resume-generator/lib/exportResume', async (importActual) => {
  const actual = await importActual<typeof import('@/features/resume-generator/lib/exportResume')>();
  return { ...actual, exportPdf: vi.fn().mockResolvedValue('resume.pdf') };
});

import { generateResumeFromText } from '@/features/resume-generator/lib/resumeIntake';

const SENSITIVE_KEY = /(resume|job|description|text|content|raw|model|name|email|phone|url|link|address)/i;
const SECRET_TEXT = 'Jane Doe jane@example.com — Senior Engineer who built payment systems at Acme Corp.';

function buildDraft(): ResumeIntakeResult {
  const resume = getDefaultResume('en');
  return {
    resume,
    confidence: {
      overall: 0.9,
      sections: { personal: 0.9, summary: 0.9, experience: 0.9, education: 0.9, skills: 0.9, projects: 0.9 },
    },
    warnings: [{ code: 'LOW_CONFIDENCE', message: 'Low confidence on dates' }],
    source: { kind: 'paragraph', extractedText: SECRET_TEXT },
  };
}

function assertPrivacySafe(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    expect(SENSITIVE_KEY.test(key), `unexpected sensitive key: ${key}`).toBe(false);
  }
  expect(JSON.stringify(payload)).not.toContain('Jane Doe');
  expect(JSON.stringify(payload)).not.toContain('jane@example.com');
}

function callsFor(event: string) {
  return trackMock.mock.calls.filter(call => call[0] === event);
}

describe('funnel analytics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    trackMock.mockClear();
    useLocaleStore.getState().setLocale('en');
    seedStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.mocked(generateResumeFromText).mockReset();
  });

  it('emits a privacy-safe intake_completed on successful text intake', async () => {
    vi.mocked(generateResumeFromText).mockResolvedValue(buildDraft());

    await renderStart();
    await typeIntoTextarea(SECRET_TEXT);
    await clickButton('Generate draft');
    await flush();

    const completed = callsFor('intake_completed');
    expect(completed).toHaveLength(1);
    const payload = completed[0][1] as Record<string, unknown>;
    expect(payload.source).toBe('text');
    expect(payload.warningCodes).toEqual(['LOW_CONFIDENCE']);
    expect(payload.usedFallback).toBe(false);
    assertPrivacySafe(payload);
  });

  it('emits intake_failed with a reason on text intake failure', async () => {
    vi.mocked(generateResumeFromText).mockRejectedValue(new Error('Daily limit reached for this device'));

    await renderStart();
    await typeIntoTextarea(SECRET_TEXT);
    await clickButton('Generate draft');
    await flush();

    const failed = callsFor('intake_failed');
    expect(failed).toHaveLength(1);
    const payload = failed[0][1] as Record<string, unknown>;
    expect(payload.source).toBe('text');
    expect(payload.reason).toBe('quota');
    assertPrivacySafe(payload);
  });

  it('emits export_started and export_completed with issue codes only', async () => {
    await renderExport();
    await clickButton('Download PDF');
    await flush();

    const started = callsFor('export_started');
    const completed = callsFor('export_completed');
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);

    for (const [, payload] of [...started, ...completed]) {
      const safe = payload as Record<string, unknown>;
      expect(safe.format).toBe('pdf');
      expect(Array.isArray(safe.issueCodes)).toBe(true);
      assertPrivacySafe(safe);
    }
  });

  async function renderStart() {
    await act(async () => {
      root.render(<StartIntakeSection onGoToContent={() => {}} />);
    });
    await flush();
  }

  async function renderExport() {
    await act(async () => {
      root.render(<ExportSection />);
    });
    await flush();
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function typeIntoTextarea(value: string) {
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(textarea, value);
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text));
    expect(button, `button not found: ${text}`).toBeTruthy();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
});

function seedStore() {
  const resume = getDefaultResume('en');
  const document = createResumeDocument(resume, { id: 'doc-analytics', title: 'Analytics Resume', now: '2026-05-18T08:00:00.000Z' });
  useResumeGeneratorStore.setState({
    ...useResumeGeneratorStore.getState(),
    documents: [document],
    activeDocumentId: document.id,
    resume: document.resume,
    typstSource: renderResumeToTypst(document.resume, document.resume.templateId, 'en'),
    versions: [],
    renderStatus: 'success',
    renderError: null,
    svgHtml: '<svg></svg>',
    lastIntakeWarnings: [],
    hasDismissedOnboarding: true,
  });
}
