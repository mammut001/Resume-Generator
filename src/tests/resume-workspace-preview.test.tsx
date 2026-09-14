// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeGeneratorPage } from '@/features/resume-generator/components/ResumeGeneratorPage';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

const READY_SVG = '<svg data-preview-svg="ready"><text>Alex Chen</text></svg>';
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
  Toaster: () => null,
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

describe('ResumeGeneratorPage workspace preview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    stubMatchMedia(false);
    renderTypstMock.mockResolvedValue({ ok: true, svgHtml: READY_SVG });
    resetStore({
      renderStatus: 'success',
      renderError: null,
      svgHtml: READY_SVG,
    });
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

  it('exposes a narrow preview control and shows the live Typst preview after it is used', async () => {
    await renderPage();

    const openControl = getPreviewControl('open');
    expect(openControl.textContent).toContain('Inspect preview');
    expect(getPreviewSurface()?.getAttribute('data-preview-surface')).toBe('docked');

    await act(async () => {
      openControl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const surface = getPreviewSurface();
    expect(surface?.getAttribute('data-preview-surface')).toBe('overlay');
    expect(surface?.getAttribute('role')).toBe('dialog');
    expect(container.querySelector('[data-preview-svg="ready"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Zoom in"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Zoom out"]')).toBeTruthy();
    expect(getTabLabels()).toEqual(expect.arrayContaining(['Preview']));
    expect(container.textContent).toContain('Ready');
    expect(getPreviewControl('close').textContent).toContain('Back to editor');
  });

  it('shows rendering and unavailable states through the same narrow preview path', async () => {
    resetStore({
      renderStatus: 'error',
      renderError: 'Render failed with status 500',
      svgHtml: null,
    });
    await renderPage();

    await act(async () => {
      getPreviewControl('open').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getPreviewSurface()?.getAttribute('data-preview-surface')).toBe('overlay');
    expect(container.textContent).toContain('Preview service unavailable');
    expect(container.textContent).toContain('npm run dev');
    expect(container.textContent).toContain('Export tab');

    await act(async () => {
      useResumeGeneratorStore.setState({
        renderStatus: 'rendering',
        renderError: null,
        svgHtml: null,
      });
    });

    expect(container.textContent).toContain('Rendering...');
  });

  it('keeps editor tabs and preview chrome together on a wide workspace', async () => {
    stubMatchMedia(true);
    await renderPage();

    expect(getTabLabels()).toEqual(expect.arrayContaining(['Start', 'Content', 'Design', 'Tailor', 'Export', 'Preview']));
    expect(getPreviewSurface()?.getAttribute('data-preview-surface')).toBe('docked');
    expect(getPreviewSurface()?.className).toContain('lg:flex');
    expect(container.querySelector('button[aria-label="Zoom in"]')).toBeTruthy();
    expect(container.querySelector('[data-preview-svg="ready"]')).toBeTruthy();
    expect(container.querySelector('[data-preview-control="close"]')).toBeNull();
  });

  it('keeps PDF export available with the workspace tabs', async () => {
    await renderPage();

    expect(getTabLabels()).toEqual(expect.arrayContaining(['Start', 'Content', 'Design', 'Tailor', 'Export']));
    const pdfButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('PDF'));
    expect(pdfButton).toBeTruthy();

    await act(async () => {
      getPreviewControl('open').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const overlayPdfButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('PDF'));
    expect(overlayPdfButton).toBeTruthy();
  });

  it('uses zh-CN copy for the narrow preview controls', async () => {
    useLocaleStore.getState().setLocale('zh-CN');
    await renderPage();

    expect(getPreviewControl('open').textContent).toContain('查看预览');

    await act(async () => {
      getPreviewControl('open').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getPreviewControl('close').textContent).toContain('返回编辑');
  });

  async function renderPage() {
    await act(async () => {
      root.render(<ResumeGeneratorPage />);
    });
  }

  function getPreviewControl(name: 'open' | 'close'): HTMLButtonElement {
    const button = container.querySelector(`[data-preview-control="${name}"]`) as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    return button!;
  }

  function getPreviewSurface(): HTMLElement | null {
    return container.querySelector('#resume-preview-surface');
  }

  function getTabLabels(): string[] {
    return Array.from(container.querySelectorAll('[role="tab"]')).map(tab => tab.textContent?.trim() || '');
  }
});

function stubMatchMedia(matches: boolean) {
  const media = {
    matches,
    media: '(min-width: 1024px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(media);
}

function resetStore(overrides: {
  renderStatus: 'idle' | 'rendering' | 'success' | 'error';
  renderError: string | null;
  svgHtml: string | null;
}) {
  const document = createResumeDocument(getDefaultResume('en'), { title: 'Master Resume' });
  const resume = document.resume;
  useResumeGeneratorStore.setState({
    documents: [document],
    activeDocumentId: document.id,
    resume,
    typstSource: renderResumeToTypst(resume, resume.templateId, 'en'),
    lastIntakeWarnings: [],
    versions: [],
    hasDismissedOnboarding: true,
    ...overrides,
  });
}
