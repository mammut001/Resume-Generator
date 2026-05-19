// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeEditorPanel } from '@/features/resume-generator/components/ResumeEditorPanel';
import { ResumeTailoringPanel } from '@/features/resume-generator/components/ResumeTailoringPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument, loadResumeWorkspace } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';
import type { ResumeTailoringResult } from '@/types/resume';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

const jobDescription = 'Title: Frontend Platform Engineer. Need React, TypeScript, accessibility, design systems, Playwright testing, and Kubernetes experience.';

describe('ResumeTailoringPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    resetStore();

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/usage')) {
        return jsonResponse({ remainingAttempts: 3, limit: 3, resetAt: null });
      }

      if (url.endsWith('/resume')) {
        const body = JSON.parse(init?.body?.toString() || '{}') as { jobDescription: string };
        expect(body.jobDescription).toContain('Frontend Platform Engineer');
        return jsonResponse(tailoringResult());
      }

      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders the Tailor tab in the editor', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    expect(container.textContent).toContain('Tailor');
  });

  it('submits a job description, renders review details, and applies as a persisted new document', async () => {
    await renderPanel();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const textAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      textAreaValueSetter?.call(textarea, jobDescription);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      getButton('Generate tailored draft').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushUi();

    expect(fetchMock).toHaveBeenCalledWith('/api/tailor/resume', expect.objectContaining({ method: 'POST' }));
    expect(container.textContent).toContain('Frontend Platform Engineer');
    expect(container.textContent).toContain('React');
    expect(container.textContent).toContain('Kubernetes');
    expect(container.textContent).toContain('Rewrote summary toward platform role.');
    expect(container.textContent).toContain('Gap: Kubernetes is not supported by this resume.');
    expect(container.textContent).toContain('1 accepted');
    expect(container.textContent).toContain('0 rejected');

    await act(async () => {
      getButton('Reject').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('0 accepted');
    expect(container.textContent).toContain('1 rejected');
    expect(getButton('Apply selected changes').disabled).toBe(true);

    await act(async () => {
      getButton('Accept').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const sourceDocumentId = useResumeGeneratorStore.getState().activeDocumentId;
    const sourceSummary = useResumeGeneratorStore.getState().resume.summary;

    await act(async () => {
      getButton('Apply selected changes').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const state = useResumeGeneratorStore.getState();
    const sourceDocument = state.documents.find(document => document.id === sourceDocumentId);
    const activeDocument = state.documents.find(document => document.id === state.activeDocumentId);
    const persisted = loadResumeWorkspace('en');

    expect(state.documents).toHaveLength(2);
    expect(activeDocument?.title).toContain('Tailored for Frontend Platform Engineer');
    expect(activeDocument?.resume.summary).toContain('platform teams');
    expect(sourceDocument?.resume.summary).toBe(sourceSummary);
    expect(persisted.documents).toHaveLength(2);
    expect(persisted.activeDocumentId).toBe(state.activeDocumentId);
  });

  async function renderPanel() {
    await act(async () => {
      root.render(<ResumeTailoringPanel />);
    });
    await flushUi();
  }

  function getButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }
});

function resetStore() {
  const resume = {
    ...getDefaultResume('en'),
    title: 'Master Resume',
    summary: 'Frontend engineer with React, TypeScript, accessibility, and design-system experience.',
  };
  const document = createResumeDocument(resume, {
    id: 'doc-master',
    title: 'Master Resume',
    now: '2026-05-18T08:00:00.000Z',
  });

  useResumeGeneratorStore.setState({
    ...useResumeGeneratorStore.getState(),
    documents: [document],
    activeDocumentId: document.id,
    resume: document.resume,
    typstSource: renderResumeToTypst(document.resume, document.resume.templateId, 'en'),
    versions: [],
    renderStatus: 'idle',
    renderError: null,
    svgHtml: null,
  });
}

function tailoringResult(): ResumeTailoringResult {
  const resume = useResumeGeneratorStore.getState().resume;
  return {
    tailoredResume: {
      ...resume,
      id: 'tailored-platform',
      title: 'Master Resume - Tailored for Frontend Platform Engineer',
      summary: 'Frontend engineer focused on platform teams with React, TypeScript, accessibility, and design-system experience.',
    },
    summary: {
      targetRole: 'Frontend Platform Engineer',
      keyRequirements: ['React', 'TypeScript', 'Kubernetes'],
      matchedStrengths: ['React', 'TypeScript'],
      gaps: ['Kubernetes'],
    },
    changes: [{
      id: 'change-summary',
      section: 'summary',
      kind: 'rewritten',
      description: 'Rewrote summary toward platform role.',
      targetPath: 'summary',
      before: resume.summary,
      after: 'Frontend engineer focused on platform teams with React, TypeScript, accessibility, and design-system experience.',
    }],
    warnings: [{
      code: 'TAILORING_GAP',
      message: 'The job description asks for Kubernetes, but that is not supported by the current resume.',
      requirement: 'Kubernetes',
    }],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}