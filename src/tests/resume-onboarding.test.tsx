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

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  trackAnalyticsEvent: trackMock,
  sanitizeAnalyticsPayload: (payload: Record<string, unknown>) => payload,
}));

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
    trackMock.mockClear();
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

    expect(container.textContent).toContain('Turn rough notes into a polished resume.');
    expect(container.textContent).toContain('Paste rough notes or upload a resume');
    expect(container.textContent).toContain('Get an editable resume draft');
    expect(container.textContent).toContain('Export a polished PDF');
    expect(container.textContent).toContain('Start with sample');
    expect(container.textContent).toContain('Paste text');
    expect(container.textContent).toContain('Upload PDF');
    expect(container.textContent).toContain('Your resumes are saved locally in this browser for now');
  });

  it('fires start_action_clicked when a start action is clicked', async () => {
    await renderPanel();

    await act(async () => {
      getButton('Start with sample').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(trackMock).toHaveBeenCalledWith('start_action_clicked', { action: 'sample' });
  });

  it('focuses the paragraph textarea when Paste text is clicked', async () => {
    await renderPanel();

    await act(async () => {
      getButton('Paste text').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Yield once so the focus effect inside StartIntakeSection can run.
      await Promise.resolve();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(document.activeElement).toBe(textarea);
  });

  it('dismisses onboarding and persists across reload', async () => {
    await renderPanel();

    await act(async () => {
      getButton('Hide guide').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('Turn rough notes into a polished resume.');
    expect(loadResumeWorkspace('en').hasDismissedOnboarding).toBe(true);

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);

    await renderPanel();

    expect(container.textContent).not.toContain('Turn rough notes into a polished resume.');
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

    expect(container.textContent).not.toContain('Turn rough notes into a polished resume.');
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
