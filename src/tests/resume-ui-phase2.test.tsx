// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionVerbsHelper,
  DesignSection,
  ResumeEditorPanel,
} from '@/features/resume-generator/components/ResumeEditorPanel';
import { ResumePreviewPanel } from '@/features/resume-generator/components/ResumePreviewPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { PAGE_DIMENSIONS, isValidHexColor } from '@/features/resume-generator/data/resumeDesign';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

const renderTypstMock = vi.fn();

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypst: (...args: unknown[]) => renderTypstMock(...args),
  renderTypstToPdf: vi.fn(async () => ({ ok: true, pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }) })),
}));

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
  },
}));

describe('UI Phase 2: Dynamic Page Dimensions, Page Boundary & Overflow Warning', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('sets dynamic canvas dimensions for Letter pageSize (816px x 1056px)', async () => {
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'letter',
        },
      },
      renderStatus: 'idle',
      svgHtml: null,
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    const canvas = container.querySelector('[data-testid="preview-page-canvas"]') as HTMLElement;
    expect(canvas).toBeTruthy();
    expect(canvas.style.width).toBe(`${PAGE_DIMENSIONS.letter.width}px`);
    expect(canvas.style.minHeight).toBe(`${PAGE_DIMENSIONS.letter.height}px`);
  });

  it('sets dynamic canvas dimensions for A4 pageSize (794px x 1123px)', async () => {
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'a4',
        },
      },
      renderStatus: 'idle',
      svgHtml: null,
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    const canvas = container.querySelector('[data-testid="preview-page-canvas"]') as HTMLElement;
    expect(canvas).toBeTruthy();
    expect(canvas.style.width).toBe(`${PAGE_DIMENSIONS.a4.width}px`);
    expect(canvas.style.minHeight).toBe(`${PAGE_DIMENSIONS.a4.height}px`);
  });

  it('renders dashed boundary line and slight overflow warning when content exceeds single page by < 200px', async () => {
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'letter',
        },
      },
      renderStatus: 'success',
      svgHtml: '<div style="height: 1100px;">Overflown content</div>',
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    const boundaryIndicator = container.querySelector('[data-testid="page-boundary-indicator"]') as HTMLElement;
    expect(boundaryIndicator).toBeTruthy();
    expect(boundaryIndicator.style.top).toBe('1056px');
    expect(boundaryIndicator.textContent).toContain('Page 1 / 2 boundary');

    const warningAlert = container.querySelector('[data-testid="preview-overflow-warning"]');
    expect(warningAlert).toBeTruthy();
    expect(warningAlert?.textContent).toContain('Content exceeds 1 page by a small margin');
  });

  it('renders boundary line but suppresses slight overflow warning when overflow is large (> 200px)', async () => {
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'letter',
        },
      },
      renderStatus: 'success',
      svgHtml: '<div style="height: 1400px;">Multi-page content</div>',
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    const boundaryIndicator = container.querySelector('[data-testid="page-boundary-indicator"]') as HTMLElement;
    expect(boundaryIndicator).toBeTruthy();
    expect(boundaryIndicator.style.top).toBe('1056px');

    const warningAlert = container.querySelector('[data-testid="preview-overflow-warning"]');
    expect(warningAlert).toBeNull();
  });

  it('does not render boundary line or warning when content fits on 1 page', async () => {
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'letter',
        },
      },
      renderStatus: 'success',
      svgHtml: '<div style="height: 800px;">Short content</div>',
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    expect(container.querySelector('[data-testid="page-boundary-indicator"]')).toBeNull();
    expect(container.querySelector('[data-testid="preview-overflow-warning"]')).toBeNull();
  });

  it('localizes page boundary and overflow warning in zh-CN', async () => {
    useLocaleStore.getState().setLocale('zh-CN');
    useResumeGeneratorStore.setState({
      resume: {
        ...useResumeGeneratorStore.getState().resume,
        design: {
          ...useResumeGeneratorStore.getState().resume.design,
          pageSize: 'a4',
        },
      },
      renderStatus: 'success',
      svgHtml: '<div style="height: 1180px;">超出一页的内容</div>',
    });

    await act(async () => {
      root.render(<ResumePreviewPanel />);
    });

    const boundaryIndicator = container.querySelector('[data-testid="page-boundary-indicator"]') as HTMLElement;
    expect(boundaryIndicator).toBeTruthy();
    expect(boundaryIndicator.style.top).toBe('1123px');
    expect(boundaryIndicator.textContent).toContain('第 1 / 2 页分页线');

    const warningAlert = container.querySelector('[data-testid="preview-overflow-warning"]');
    expect(warningAlert).toBeTruthy();
    expect(warningAlert?.textContent).toContain('内容略微超出单页');
  });
});

describe('UI Phase 2: Template Gallery Grid & Custom Hex Color Picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('validates hex color format correctly with isValidHexColor', () => {
    expect(isValidHexColor('#2563eb')).toBe(true);
    expect(isValidHexColor('#000000')).toBe(true);
    expect(isValidHexColor('#FFFFFF')).toBe(true);
    expect(isValidHexColor('#10b981')).toBe(true);

    expect(isValidHexColor('2563eb')).toBe(false);
    expect(isValidHexColor('#fff')).toBe(false);
    expect(isValidHexColor('#12345')).toBe(false);
    expect(isValidHexColor('#1234567')).toBe(false);
    expect(isValidHexColor('blue')).toBe(false);
  });

  it('renders custom color picker controls inside DesignSection', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    const colorPickerContainer = container.querySelector('[data-testid="custom-color-picker"]');
    expect(colorPickerContainer).toBeTruthy();

    const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput).toBeTruthy();
    expect(colorInput.value).toBe('#2563eb');

    const hexInput = container.querySelector('input[type="text"][aria-label="Hex color"]') as HTMLInputElement;
    expect(hexInput).toBeTruthy();
    expect(hexInput.value).toBe('#2563eb');
  });

  it('updates store accentColor when picking color via color input', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(colorInput, '#10b981');
      colorInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useResumeGeneratorStore.getState().resume.design.accentColor).toBe('#10b981');
  });

  it('updates store accentColor when typing a valid hex in text input', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    const hexInput = container.querySelector('input[type="text"][aria-label="Hex color"]') as HTMLInputElement;

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(hexInput, '#7c3aed');
      hexInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useResumeGeneratorStore.getState().resume.design.accentColor).toBe('#7c3aed');
  });

  it('ignores invalid hex inputs without updating store accentColor', async () => {
    const initialColor = useResumeGeneratorStore.getState().resume.design.accentColor;

    await act(async () => {
      root.render(<DesignSection />);
    });

    const hexInput = container.querySelector('input[type="text"][aria-label="Hex color"]') as HTMLInputElement;

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(hexInput, '#invalid');
      hexInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useResumeGeneratorStore.getState().resume.design.accentColor).toBe(initialColor);
  });

  it('syncs custom color inputs when preset color is clicked', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    const tealButton = container.querySelector('button[title="Teal"]') as HTMLButtonElement;
    expect(tealButton).toBeTruthy();

    await act(async () => {
      tealButton.click();
    });

    expect(useResumeGeneratorStore.getState().resume.design.accentColor).toBe('#0f766e');

    const hexInput = container.querySelector('input[type="text"][aria-label="Hex color"]') as HTMLInputElement;
    expect(hexInput.value).toBe('#0f766e');

    const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput.value).toBe('#0f766e');
  });

  it('renders template gallery cards with active state ring and layout badge', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    const activeCard = container.querySelector('button[aria-pressed="true"]');
    expect(activeCard).toBeTruthy();
    expect(activeCard?.className).toContain('ring-2');
    expect(activeCard?.textContent).toContain('Current');
    expect(activeCard?.textContent).toContain('ATS-first single column');
  });
});

describe('UI Phase 2: ATS Action Verbs & Bullet Assistance Helper', () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
    resetStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();

    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Action Verbs helper in collapsed state initially', async () => {
    await act(async () => {
      root.render(<ActionVerbsHelper />);
    });

    const toggleBtn = container.querySelector('[data-testid="action-verbs-toggle"]') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.textContent).toContain('Action Verbs & Bullets Helper');
    expect(container.querySelector('[data-testid="action-verbs-content"]')).toBeNull();
  });

  it('expands helper when clicked to show XYZ formula and categorized verb chips', async () => {
    await act(async () => {
      root.render(<ActionVerbsHelper />);
    });

    const toggleBtn = container.querySelector('[data-testid="action-verbs-toggle"]') as HTMLButtonElement;

    await act(async () => {
      toggleBtn.click();
    });

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const content = container.querySelector('[data-testid="action-verbs-content"]');
    expect(content).toBeTruthy();

    expect(content?.textContent).toContain('Accomplished [X] as measured by [Y], by doing [Z]');
    expect(container.querySelector('[data-testid="copy-formula-btn"]')).toBeTruthy();

    expect(content?.textContent).toContain('Leadership');
    expect(content?.textContent).toContain('Impact');
    expect(content?.textContent).toContain('Development');

    expect(container.querySelector('[data-testid="verb-chip-led"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="verb-chip-optimized"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="verb-chip-designed"]')).toBeTruthy();
  });

  it('copies verb to clipboard and displays toast notification', async () => {
    await act(async () => {
      root.render(<ActionVerbsHelper />);
    });

    const toggleBtn = container.querySelector('[data-testid="action-verbs-toggle"]') as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
    });

    const ledChip = container.querySelector('[data-testid="verb-chip-led"]') as HTMLButtonElement;
    expect(ledChip).toBeTruthy();

    await act(async () => {
      ledChip.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('Led');
    expect(toastSuccessMock).toHaveBeenCalledWith("Copied 'Led' to clipboard");
  });

  it('copies XYZ formula to clipboard when Copy formula is clicked', async () => {
    await act(async () => {
      root.render(<ActionVerbsHelper />);
    });

    const toggleBtn = container.querySelector('[data-testid="action-verbs-toggle"]') as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
    });

    const copyFormulaBtn = container.querySelector('[data-testid="copy-formula-btn"]') as HTMLButtonElement;
    expect(copyFormulaBtn).toBeTruthy();

    await act(async () => {
      copyFormulaBtn.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('Accomplished [X] as measured by [Y], by doing [Z]');
    expect(toastSuccessMock).toHaveBeenCalledWith('Copied to clipboard', expect.objectContaining({
      description: 'Accomplished [X] as measured by [Y], by doing [Z]',
    }));
  });

  it('collapses helper when toggle button is clicked again', async () => {
    await act(async () => {
      root.render(<ActionVerbsHelper />);
    });

    const toggleBtn = container.querySelector('[data-testid="action-verbs-toggle"]') as HTMLButtonElement;

    // Open
    await act(async () => {
      toggleBtn.click();
    });
    expect(container.querySelector('[data-testid="action-verbs-content"]')).toBeTruthy();

    // Close
    await act(async () => {
      toggleBtn.click();
    });
    expect(container.querySelector('[data-testid="action-verbs-content"]')).toBeNull();
  });

  it('renders ActionVerbsHelper inside ExperienceSection of ResumeEditorPanel', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    const contentTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      tab => tab.textContent?.trim() === 'Content',
    ) as HTMLElement;
    expect(contentTab).toBeTruthy();

    await act(async () => {
      contentTab.click();
    });

    expect(container.querySelector('[data-testid="action-verbs-toggle"]')).toBeTruthy();
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
