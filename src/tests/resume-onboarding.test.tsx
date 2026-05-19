// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeEditorPanel } from '@/features/resume-generator/components/ResumeEditorPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument, loadResumeWorkspace, saveResumeWorkspace } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('first-run onboarding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    resetStore(getDefaultResume('en'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('appears on an untouched first-run workspace', async () => {
    await renderPanel();

    expect(container.textContent).toContain('Build a resume from whatever you already have.');
    expect(container.textContent).toContain('Upload a PDF resume');
    expect(container.textContent).toContain('Paste rough text');
    expect(container.textContent).toContain('Start manually');
    expect(container.textContent).toContain('Your resumes are saved locally in this browser for now');
    expect(container.textContent).toContain('1. Start');
  });

  it('dismisses onboarding and persists across reload', async () => {
    await renderPanel();

    await act(async () => {
      getButton('Hide guide').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('Build a resume from whatever you already have.');
    expect(loadResumeWorkspace('en').hasDismissedOnboarding).toBe(true);

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);

    await renderPanel();

    expect(container.textContent).not.toContain('Build a resume from whatever you already have.');
  });

  it('does not reappear when workspace already contains meaningful content', async () => {
    const resume = {
      ...getDefaultResume('en'),
      summary: 'Real content that came from an imported or edited resume.',
    };
    const document = createResumeDocument(resume, { id: 'doc-real', title: 'Real Resume' });
    saveResumeWorkspace({
      version: 1,
      activeDocumentId: document.id,
      documents: [document],
      hasDismissedOnboarding: false,
    });
    resetStore(document.resume, document.title, document.id);

    await renderPanel();

    expect(container.textContent).not.toContain('Build a resume from whatever you already have.');
    expect(container.textContent).toContain('Real Resume');
  });

  async function renderPanel() {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function resetStore(resume: ReturnType<typeof getDefaultResume>, title = resume.title, documentId = 'doc-test') {
    const document = createResumeDocument(resume, {
      id: documentId,
      title,
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
      hasDismissedOnboarding: false,
    });
  }

  function getButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }
});
