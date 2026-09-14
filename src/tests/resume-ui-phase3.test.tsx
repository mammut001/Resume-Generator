// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResumeEditorPanel,
  ThemeSwitcher,
} from '@/features/resume-generator/components/ResumeEditorPanel';
import {
  AtsScoreGauge,
  computeAtsMatchScore,
  ResumeTailoringPanel,
} from '@/features/resume-generator/components/ResumeTailoringPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { translate, useLocaleStore } from '@/i18n';
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setupSystemThemeListener,
  THEME_STORAGE_KEY,
  useThemeStore,
} from '@/lib/themeStore';
import type { ResumeTailoringResult } from '@/types/resume';

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: vi.fn(),
  },
}));

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypst: vi.fn(async () => ({ ok: true, svgHtml: '<svg></svg>' })),
  renderTypstToPdf: vi.fn(async () => ({ ok: true, pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }) })),
}));

describe('UI Phase 3: Global Theme System & Dark Mode', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mediaQueryListeners: Array<(e: { matches: boolean }) => void> = [];
  let prefersDark = false;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.documentElement.className = '';
    useLocaleStore.getState().setLocale('en');
    useThemeStore.setState({ theme: 'system', resolvedTheme: 'light' });

    mediaQueryListeners = [];
    prefersDark = false;

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      onchange: null,
      addListener: vi.fn((listener: (e: { matches: boolean }) => void) => {
        mediaQueryListeners.push(listener);
      }),
      removeListener: vi.fn((listener: (e: { matches: boolean }) => void) => {
        mediaQueryListeners = mediaQueryListeners.filter(l => l !== listener);
      }),
      addEventListener: vi.fn((event: string, listener: (e: { matches: boolean }) => void) => {
        if (event === 'change') mediaQueryListeners.push(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: (e: { matches: boolean }) => void) => {
        if (event === 'change') {
          mediaQueryListeners = mediaQueryListeners.filter(l => l !== listener);
        }
      }),
      dispatchEvent: vi.fn(),
    }));

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
    document.documentElement.className = '';
    localStorage.clear();
  });

  it('reads initial theme preference from localStorage or falls back to system', () => {
    expect(getStoredTheme()).toBe('system');

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredTheme()).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(getStoredTheme()).toBe('light');

    localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    expect(getStoredTheme()).toBe('system');
  });

  it('correctly resolves theme based on system prefers-color-scheme', () => {
    prefersDark = false;
    expect(resolveTheme('system')).toBe('light');

    prefersDark = true;
    expect(resolveTheme('system')).toBe('dark');

    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('dynamically manipulates dark class on document.documentElement', () => {
    // Light
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Dark
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Light again
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles theme through useThemeStore and persists to localStorage', () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(useThemeStore.getState().theme).toBe('light');
    expect(useThemeStore.getState().resolvedTheme).toBe('light');
  });

  it('reacts to system preference change event when in system mode', () => {
    setupSystemThemeListener();
    useThemeStore.getState().setTheme('system');

    // System switches to dark
    act(() => {
      mediaQueryListeners.forEach(listener => listener({ matches: true }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(useThemeStore.getState().resolvedTheme).toBe('dark');

    // System switches to light
    act(() => {
      mediaQueryListeners.forEach(listener => listener({ matches: false }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(useThemeStore.getState().resolvedTheme).toBe('light');

    // When theme is explicitly 'light', system change does not alter it
    useThemeStore.getState().setTheme('light');
    act(() => {
      mediaQueryListeners.forEach(listener => listener({ matches: true }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('cycles theme through toggleTheme helper: system -> light -> dark -> system', () => {
    useThemeStore.getState().setTheme('system');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('renders ThemeSwitcher in header with accessible label and tooltip', async () => {
    useThemeStore.getState().setTheme('light');

    await act(async () => {
      root.render(<ThemeSwitcher />);
    });

    const trigger = container.querySelector('[data-testid="theme-switcher"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-label')).toContain('Theme');
    expect(trigger.getAttribute('title')).toContain('Light');

    // Click cycles to dark
    await act(async () => {
      trigger.click();
    });

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(trigger.getAttribute('title')).toContain('Dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('renders ThemeSwitcher inside ResumeEditorPanel header next to LanguageSwitcher', async () => {
    const doc = createResumeDocument(getDefaultResume('en'));
    useResumeGeneratorStore.setState({
      documents: [doc],
      activeDocumentId: doc.id,
      resume: doc.resume,
      typstSource: '',
      renderStatus: 'idle',
      hasDismissedOnboarding: true,
    });

    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    expect(container.querySelector('[data-testid="theme-switcher"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Language"]')).toBeTruthy();
  });
});

describe('UI Phase 3: ATS Match Score & Circular Donut Gauge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');
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

  it('computes ATS Match Score accurately with computeAtsMatchScore formula', () => {
    // 4 matched out of 5 total -> 80%
    expect(computeAtsMatchScore(4, 1)).toBe(80);

    // 2 matched out of 3 total -> 67%
    expect(computeAtsMatchScore(2, 1)).toBe(67);

    // 1 matched out of 4 total -> 25%
    expect(computeAtsMatchScore(1, 3)).toBe(25);

    // 0 matched out of 0 -> 0%
    expect(computeAtsMatchScore(0, 0)).toBe(0);

    // 3 matched out of 3 -> 100%
    expect(computeAtsMatchScore(3, 0)).toBe(100);

    // 0 matched out of 4 -> 0%
    expect(computeAtsMatchScore(0, 4)).toBe(0);
  });

  it('renders circular SVG donut gauge with score percentage and emerald tone for > 75%', async () => {
    await act(async () => {
      root.render(<AtsScoreGauge score={85} />);
    });

    const gauge = container.querySelector('[data-testid="ats-score-gauge"]');
    expect(gauge).toBeTruthy();
    expect(gauge?.getAttribute('data-score')).toBe('85');
    expect(gauge?.textContent).toContain('85%');
    expect(gauge?.textContent).toContain('ATS Match Score');

    // SVG elements
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
    const progressCircle = circles[1];
    expect(progressCircle.getAttribute('stroke-dasharray')).toBe('238.76104167282426');
    expect(progressCircle.className.baseVal).toContain('stroke-emerald-500');
  });

  it('renders amber tone for score between 50% and 74%', async () => {
    await act(async () => {
      root.render(<AtsScoreGauge score={67} />);
    });

    const gauge = container.querySelector('[data-testid="ats-score-gauge"]');
    expect(gauge).toBeTruthy();
    expect(gauge?.textContent).toContain('67%');

    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle.className.baseVal).toContain('stroke-amber-500');
  });

  it('renders rose tone for score below 50%', async () => {
    await act(async () => {
      root.render(<AtsScoreGauge score={33} />);
    });

    const gauge = container.querySelector('[data-testid="ats-score-gauge"]');
    expect(gauge).toBeTruthy();
    expect(gauge?.textContent).toContain('33%');

    const progressCircle = container.querySelectorAll('circle')[1];
    expect(progressCircle.className.baseVal).toContain('stroke-rose-500');
  });
});

describe('UI Phase 3: Tailoring Panel Keyword Matrix, Diff Cards & Bulk Decisions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    resetStore();

    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/usage')) {
        return jsonResponse({ remainingAttempts: 3, limit: 3, resetAt: null });
      }
      if (url.endsWith('/resume')) {
        return jsonResponse(mockTailoringResult());
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

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
    vi.unstubAllGlobals();
  });

  it('renders ATS score gauge, keyword matrix, and diff review when draft is generated', async () => {
    await renderTailoringPanel();
    await generateDraft();

    // ATS Match score Donut gauge: 2 matched / (2 matched + 1 gap) = 67%
    const gauge = container.querySelector('[data-testid="ats-score-gauge"]');
    expect(gauge).toBeTruthy();
    expect(gauge?.textContent).toContain('67%');
    expect(gauge?.textContent).toContain('ATS Match Score');

    // Keyword Matrix: Matched strengths & gaps
    expect(container.textContent).toContain('Matched Strengths');
    expect(container.textContent).toContain('React');
    expect(container.textContent).toContain('TypeScript');
    expect(container.textContent).toContain('Kubernetes');

    // Target role & requirements
    expect(container.textContent).toContain('Frontend Platform Engineer');

    // Proposed changes diff card
    const diffCard = container.querySelector('[data-testid="diff-card-change-summary"]');
    expect(diffCard).toBeTruthy();
    expect(diffCard?.textContent).toContain('Summary');
    expect(diffCard?.textContent).toContain('Rewritten');
    expect(diffCard?.textContent).toContain('Rewrote summary toward platform role.');
    expect(diffCard?.textContent).toContain('Targeted to role requirements.');
  });

  it('copies missing gap keyword to clipboard with toast notification', async () => {
    await renderTailoringPanel();
    await generateDraft();

    const copyGapBtn = container.querySelector('[data-testid="copy-gap-Kubernetes"]') as HTMLButtonElement;
    expect(copyGapBtn).toBeTruthy();

    await act(async () => {
      copyGapBtn.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('Kubernetes');
    expect(toastSuccessMock).toHaveBeenCalledWith('Copy keyword: Kubernetes');
  });

  it('supports Accept all and Reject all bulk decisions', async () => {
    await renderTailoringPanel();
    await generateDraft();

    expect(container.textContent).toContain('2 accepted');
    expect(container.textContent).toContain('0 rejected');

    // Reject all
    const rejectAllBtn = container.querySelector('[data-testid="reject-all-btn"]') as HTMLButtonElement;
    expect(rejectAllBtn).toBeTruthy();

    await act(async () => {
      rejectAllBtn.click();
    });

    expect(container.textContent).toContain('0 accepted');
    expect(container.textContent).toContain('2 rejected');

    // Accept all
    const acceptAllBtn = container.querySelector('[data-testid="accept-all-btn"]') as HTMLButtonElement;
    expect(acceptAllBtn).toBeTruthy();

    await act(async () => {
      acceptAllBtn.click();
    });

    expect(container.textContent).toContain('2 accepted');
    expect(container.textContent).toContain('0 rejected');
  });

  async function renderTailoringPanel() {
    await act(async () => {
      root.render(<ResumeTailoringPanel />);
    });
    await flushUi();
  }

  async function generateDraft() {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const textAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      textAreaValueSetter?.call(textarea, 'Frontend Platform Engineer needed with React, TypeScript, and Kubernetes experience.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Generate tailored draft'),
    );
    expect(generateBtn).toBeTruthy();

    await act(async () => {
      generateBtn?.click();
    });
    await flushUi();
  }
});

describe('UI Phase 3: Translation Keys (en and zh-CN)', () => {
  it('provides all theme translations in en and zh-CN', () => {
    expect(translate('en', 'theme.label')).toBe('Theme');
    expect(translate('zh-CN', 'theme.label')).toBe('主题');

    expect(translate('en', 'theme.light')).toBe('Light');
    expect(translate('zh-CN', 'theme.light')).toBe('浅色');

    expect(translate('en', 'theme.dark')).toBe('Dark');
    expect(translate('zh-CN', 'theme.dark')).toBe('深色');

    expect(translate('en', 'theme.system')).toBe('System');
    expect(translate('zh-CN', 'theme.system')).toBe('跟随系统');
  });

  it('provides all tailoring matchScore, bulk decision, and copy translations in en and zh-CN', () => {
    expect(translate('en', 'tailoring.matchScore')).toBe('ATS Match Score');
    expect(translate('zh-CN', 'tailoring.matchScore')).toBe('ATS 岗位匹配度');

    expect(translate('en', 'tailoring.acceptAll')).toBe('Accept all');
    expect(translate('zh-CN', 'tailoring.acceptAll')).toBe('全部采纳');

    expect(translate('en', 'tailoring.rejectAll')).toBe('Reject all');
    expect(translate('zh-CN', 'tailoring.rejectAll')).toBe('全部放弃');

    expect(translate('en', 'tailoring.copyKeyword')).toBe('Copy keyword');
    expect(translate('zh-CN', 'tailoring.copyKeyword')).toBe('复制关键词');
  });
});

function resetStore() {
  const resume = {
    ...getDefaultResume('en'),
    title: 'Master Resume',
    summary: 'Frontend engineer with React and TypeScript experience.',
  };
  const document = createResumeDocument(resume, {
    id: 'doc-master',
    title: 'Master Resume',
  });

  useResumeGeneratorStore.setState({
    documents: [document],
    activeDocumentId: document.id,
    resume: document.resume,
    typstSource: renderResumeToTypst(document.resume, document.resume.templateId, 'en'),
    versions: [],
    renderStatus: 'idle',
    renderError: null,
    svgHtml: null,
    hasDismissedOnboarding: true,
  });
}

function mockTailoringResult(): ResumeTailoringResult {
  const resume = useResumeGeneratorStore.getState().resume;
  return {
    tailoredResume: {
      ...resume,
      id: 'tailored-platform',
      title: 'Master Resume - Tailored for Frontend Platform Engineer',
      summary: 'Frontend engineer focused on platform teams with React, TypeScript, and Kubernetes experience.',
    },
    summary: {
      targetRole: 'Frontend Platform Engineer',
      keyRequirements: ['React', 'TypeScript', 'Kubernetes'],
      matchedStrengths: ['React', 'TypeScript'],
      gaps: ['Kubernetes'],
    },
    changes: [
      {
        id: 'change-summary',
        section: 'summary',
        kind: 'rewritten',
        description: 'Rewrote summary toward platform role.',
        reason: 'Targeted to role requirements.',
        targetPath: 'summary',
        before: resume.summary,
        after: 'Frontend engineer focused on platform teams with React, TypeScript, and Kubernetes experience.',
      },
      {
        id: 'change-skills',
        section: 'skills',
        kind: 'emphasized',
        description: 'Emphasized React and TypeScript skills.',
        targetPath: 'skills',
      },
    ],
    warnings: [
      {
        code: 'TAILORING_GAP',
        message: 'The job description asks for Kubernetes, but that is not supported by the current resume.',
        requirement: 'Kubernetes',
      },
    ],
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
