// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumePreviewPanel } from '@/features/resume-generator/components/ResumePreviewPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

const renderTypstMock = vi.fn();

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypst: (...args: unknown[]) => renderTypstMock(...args),
  renderTypstToPdf: vi.fn(async () => ({ ok: true, pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }) })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ResumePreviewPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('shows a friendly message when the render service is unavailable', async () => {
    useResumeGeneratorStore.setState({
      typstSource: '',
      renderStatus: 'error',
      renderError: 'Render failed with status 500',
      svgHtml: null,
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    expect(container.textContent).toContain('Preview service unavailable');
    expect(container.textContent).toContain('npm run dev');
    expect(container.textContent).toContain('Export tab');
  });

  it('ignores stale render responses when the source changes quickly', async () => {
    vi.useFakeTimers();

    let resolveFirst: ((value: { ok: boolean; svgHtml?: string }) => void) | undefined;
    const firstRender = new Promise<{ ok: boolean; svgHtml?: string }>(resolve => {
      resolveFirst = resolve;
    });

    renderTypstMock
      .mockImplementationOnce(() => firstRender)
      .mockResolvedValueOnce({ ok: true, svgHtml: '<svg>fresh</svg>' });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(useResumeGeneratorStore.getState().renderStatus).toBe('rendering');

    await act(async () => {
      useResumeGeneratorStore.setState({
        typstSource: '#fresh source',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
    });

    expect(renderTypstMock).toHaveBeenCalledTimes(2);
    expect(useResumeGeneratorStore.getState().renderStatus).toBe('success');
    expect(useResumeGeneratorStore.getState().svgHtml).toBe('<svg>fresh</svg>');

    await act(async () => {
      resolveFirst?.({ ok: true, svgHtml: '<svg>stale</svg>' });
      await Promise.resolve();
    });

    expect(useResumeGeneratorStore.getState().svgHtml).toBe('<svg>fresh</svg>');

    vi.useRealTimers();
  });

  it('exposes accessible zoom controls', async () => {
    useResumeGeneratorStore.setState({
      renderStatus: 'idle',
      renderError: null,
      svgHtml: null,
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    expect(container.querySelector('button[aria-label="Zoom in"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Zoom out"]')).toBeTruthy();
  });
});

function resetStore() {
  const document = createResumeDocument(getDefaultResume('en'), { title: 'Master Resume' });
  const resume = document.resume;
  useResumeGeneratorStore.setState({
    documents: [document],
    activeDocumentId: document.id,
    resume,
    typstSource: renderResumeToTypst(resume, resume.templateId, 'en'),
    renderStatus: 'idle',
    renderError: null,
    svgHtml: null,
    lastIntakeWarnings: [],
    versions: [],
    hasDismissedOnboarding: true,
  });
}