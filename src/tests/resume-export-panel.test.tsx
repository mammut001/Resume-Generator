// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportSection } from '@/features/resume-generator/components/ResumeEditorPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';
import { renderTypstToPdf } from '@/features/resume-generator/lib/typstRenderer';

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypst: vi.fn(async () => ({ ok: true, svgHtml: '<svg />' })),
  renderTypstToPdf: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const renderPdfMock = vi.mocked(renderTypstToPdf);

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

describe('ExportSection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let createObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    resetStore();
    renderPdfMock.mockResolvedValue({ ok: true, pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }) });
    createObjectUrl = vi.fn(() => 'blob:resume');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows export summary, readiness, and PDF as the primary action', async () => {
    await renderExportTab();

    expect(container.textContent).toContain('Export Summary');
    expect(container.textContent).toContain('You are exporting: Master Resume');
    expect(container.textContent).toContain('This PDF will be generated from the active resume document shown here.');
    expect(container.textContent).toContain('Master Resume');
    expect(container.textContent).toContain('Alex Chen');
    expect(container.textContent).toContain('Basic Resume');
    expect(container.textContent).toContain('US Letter');
    expect(container.textContent).toContain('alex-chen-master-resume.pdf');
    expect(container.textContent).toContain('Export readiness');
    expect(container.textContent).toContain('100/100');
    expect(container.textContent).toContain('Ready to export');
    expect(container.textContent).toContain('Passed checks');
    expect(getButton('Download PDF')).toBeTruthy();
    expect(container.textContent).toContain('Advanced source export: alex-chen-master-resume.typ');
  });

  it('shows blocked readiness and can expand hidden issues', async () => {
    const currentState = useResumeGeneratorStore.getState();
    const blockedResume = {
      ...currentState.resume,
      personal: {
        ...currentState.resume.personal,
        fullName: '',
        headline: '',
        email: '',
        phone: '',
        location: '',
      },
      summary: '',
      experience: [],
      education: [],
      skills: [],
      projects: [],
    };
    useResumeGeneratorStore.setState({
      ...currentState,
      resume: blockedResume,
      typstSource: '',
      renderStatus: 'error',
      renderError: 'Preview failed',
      svgHtml: null,
    });

    await renderExportTab();

    expect(container.textContent).toContain('Export readiness');
    expect(container.textContent).toContain('Not ready');
    expect(container.textContent).toContain('Name is missing');
    expect(container.textContent).toContain('PDF export is disabled until the technical blocker is fixed.');
    expect(getButton('Download PDF').disabled).toBe(true);

    expect(container.textContent).not.toContain('No experience section');
    await act(async () => {
      getButton('Show all').click();
    });
    await flushUi();

    expect(container.textContent).toContain('No experience section');
    expect(getButton('Show less')).toBeTruthy();
  });

  it('shows OCR intake warnings in export readiness', async () => {
    useResumeGeneratorStore.getState().setLastIntakeWarnings([
      { code: 'PDF_USED_OCR', message: 'OCR was used', fieldPath: 'summary' },
    ]);

    await renderExportTab();

    expect(container.textContent).toContain('Needs review');
    expect(container.textContent).toContain('OCR was used for this resume');
    expect(container.textContent).toContain('Review names, dates, and bullet text carefully before exporting.');
  });

  it('shows a completion state after PDF export succeeds', async () => {
    localStorage.setItem('resume-generator-analytics-debug', '1');
    const analyticsInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await renderExportTab();

    await act(async () => {
      getButton('Download PDF').click();
    });
    await flushUi();

    expect(renderPdfMock).toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalled();
    expect(container.textContent).toContain('Downloaded alex-chen-master-resume.pdf');
    expect(analyticsInfo).toHaveBeenCalledWith('[analytics]', {
      event: 'export_started',
      payload: { format: 'pdf', issueCodes: [] },
    });
    expect(analyticsInfo).toHaveBeenCalledWith('[analytics]', {
      event: 'export_completed',
      payload: { format: 'pdf', issueCodes: [] },
    });
  });

  it('shows a failure state when PDF rendering fails', async () => {
    renderPdfMock.mockResolvedValue({ ok: false, error: 'Typst exploded politely' });
    await renderExportTab();

    await act(async () => {
      getButton('Download PDF').click();
    });
    await flushUi();

    expect(container.textContent).toContain('Export failed: Typst exploded politely');
  });

  async function renderExportTab() {
    await act(async () => {
      root.render(<ExportSection />);
    });
    await flushUi();
  }

  function resetStore() {
    const resume = {
      ...getDefaultResume('en'),
      title: 'Master Resume',
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
      lastIntakeWarnings: [],
      hasDismissedOnboarding: true,
    });
  }

  function getButton(text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }

  async function flushUi() {
    await act(async () => {
      await Promise.resolve();
    });
  }
});
