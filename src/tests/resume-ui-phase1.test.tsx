// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumeEditorPanel } from '@/features/resume-generator/components/ResumeEditorPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore, reorderItem } from '@/features/resume-generator/store/resumeGeneratorStore';
import { translate, useLocaleStore } from '@/i18n';

vi.mock('@/features/resume-generator/lib/typstRenderer', () => ({
  renderTypst: vi.fn(async () => ({ ok: true, svgHtml: '<svg></svg>' })),
  renderTypstToPdf: vi.fn(async () => ({ ok: true, pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }) })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UI Phase 1: Store Reordering', () => {
  it('reorders array items immutably using reorderItem helper', () => {
    const items = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
      { id: '3', name: 'Item 3' },
    ];

    // Move middle item up
    const movedUp = reorderItem(items, '2', 'up');
    expect(movedUp).toEqual([
      { id: '2', name: 'Item 2' },
      { id: '1', name: 'Item 1' },
      { id: '3', name: 'Item 3' },
    ]);
    expect(items[0].id).toBe('1'); // Original untouched

    // Move middle item down
    const movedDown = reorderItem(items, '2', 'down');
    expect(movedDown).toEqual([
      { id: '1', name: 'Item 1' },
      { id: '3', name: 'Item 3' },
      { id: '2', name: 'Item 2' },
    ]);

    // Boundary: top item up -> null
    expect(reorderItem(items, '1', 'up')).toBeNull();

    // Boundary: bottom item down -> null
    expect(reorderItem(items, '3', 'down')).toBeNull();

    // Invalid ID -> null
    expect(reorderItem(items, '999', 'up')).toBeNull();
  });

  it('reorders experience in store and updates typstSource', () => {
    const doc = createResumeDocument(getDefaultResume('en'));
    useResumeGeneratorStore.setState({
      documents: [doc],
      activeDocumentId: doc.id,
      resume: doc.resume,
      typstSource: '',
      hasDismissedOnboarding: true,
    });

    const initialExp = useResumeGeneratorStore.getState().resume.experience;
    expect(initialExp.length).toBeGreaterThanOrEqual(2);
    const firstId = initialExp[0].id;
    const secondId = initialExp[1].id;

    // Moving first item up should do nothing
    useResumeGeneratorStore.getState().moveExperience(firstId, 'up');
    expect(useResumeGeneratorStore.getState().resume.experience[0].id).toBe(firstId);

    // Moving second item up should swap first and second
    useResumeGeneratorStore.getState().moveExperience(secondId, 'up');
    const updatedExp = useResumeGeneratorStore.getState().resume.experience;
    expect(updatedExp[0].id).toBe(secondId);
    expect(updatedExp[1].id).toBe(firstId);
    expect(useResumeGeneratorStore.getState().typstSource).toBeTruthy();

    // Moving top item down should swap back
    useResumeGeneratorStore.getState().moveExperience(secondId, 'down');
    expect(useResumeGeneratorStore.getState().resume.experience[0].id).toBe(firstId);
    expect(useResumeGeneratorStore.getState().resume.experience[1].id).toBe(secondId);
  });

  it('reorders education and projects in store', () => {
    const doc = createResumeDocument({
      ...getDefaultResume('en'),
      education: [
        { id: 'edu-1', school: 'School A', degree: 'BS' },
        { id: 'edu-2', school: 'School B', degree: 'MS' },
      ],
      projects: [
        { id: 'proj-1', name: 'Project A', description: 'Desc A', bullets: [] },
        { id: 'proj-2', name: 'Project B', description: 'Desc B', bullets: [] },
      ],
    });

    useResumeGeneratorStore.setState({
      documents: [doc],
      activeDocumentId: doc.id,
      resume: doc.resume,
      typstSource: '',
      hasDismissedOnboarding: true,
    });

    // Education
    useResumeGeneratorStore.getState().moveEducation('edu-2', 'up');
    expect(useResumeGeneratorStore.getState().resume.education[0].id).toBe('edu-2');
    useResumeGeneratorStore.getState().moveEducation('edu-2', 'down');
    expect(useResumeGeneratorStore.getState().resume.education[0].id).toBe('edu-1');

    // Project
    useResumeGeneratorStore.getState().moveProject('proj-2', 'up');
    expect(useResumeGeneratorStore.getState().resume.projects[0].id).toBe('proj-2');
    useResumeGeneratorStore.getState().moveProject('proj-2', 'down');
    expect(useResumeGeneratorStore.getState().resume.projects[0].id).toBe('proj-1');
  });
});

describe('UI Phase 1: Translations', () => {
  it('provides required translation keys in en and zh-CN', () => {
    expect(translate('en', 'common.moveUp')).toBe('Move up');
    expect(translate('zh-CN', 'common.moveUp')).toBe('上移');

    expect(translate('en', 'common.moveDown')).toBe('Move down');
    expect(translate('zh-CN', 'common.moveDown')).toBe('下移');

    expect(translate('en', 'common.collapse')).toBe('Collapse');
    expect(translate('zh-CN', 'common.collapse')).toBe('折叠');

    expect(translate('en', 'common.expand')).toBe('Expand');
    expect(translate('zh-CN', 'common.expand')).toBe('展开');

    expect(translate('en', 'preview.fitWidth')).toBe('Fit width');
    expect(translate('zh-CN', 'preview.fitWidth')).toBe('适应宽度');

    expect(translate('en', 'preview.fitPage')).toBe('Fit page');
    expect(translate('zh-CN', 'preview.fitPage')).toBe('整页自适应');

    expect(translate('en', 'preview.resetZoom')).toBe('Reset zoom (100%)');
    expect(translate('zh-CN', 'preview.resetZoom')).toBe('重置缩放 (100%)');
  });
});

describe('UI Phase 1: Editor Panel Reordering and Collapsing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.getState().setLocale('en');

    const doc = createResumeDocument({
      ...getDefaultResume('en'),
      experience: [
        { id: 'exp-1', company: 'Google', role: 'Staff Engineer', startDate: '2020', endDate: '2023', bullets: ['Worked hard'] },
        { id: 'exp-2', company: 'DeepMind', role: 'Research Scientist', startDate: '2023', endDate: '', current: true, bullets: ['AI Models'] },
      ],
      education: [
        { id: 'edu-1', school: 'MIT', degree: 'BS', field: 'CS', startDate: '2016', endDate: '2020' },
        { id: 'edu-2', school: 'Stanford', degree: 'MS', field: 'AI', startDate: '2020', endDate: '2022' },
      ],
      projects: [
        { id: 'proj-1', name: 'AlphaResume', description: 'AI resume builder', url: 'https://alpha.dev', bullets: [] },
        { id: 'proj-2', name: 'BetaTypst', description: 'Typst compiler', url: '', bullets: [] },
      ],
    });

    useResumeGeneratorStore.setState({
      documents: [doc],
      activeDocumentId: doc.id,
      resume: doc.resume,
      typstSource: '',
      hasDismissedOnboarding: true,
      renderStatus: 'idle',
      renderError: null,
      svgHtml: null,
      lastIntakeWarnings: [],
      versions: [],
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

  it('renders Move Up and Move Down buttons with proper boundary disabled states', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    const moveUpButtons = container.querySelectorAll('button[aria-label="Move up"]');
    const moveDownButtons = container.querySelectorAll('button[aria-label="Move down"]');

    expect(moveUpButtons.length).toBeGreaterThanOrEqual(2);
    expect(moveDownButtons.length).toBeGreaterThanOrEqual(2);

    // First experience item: move up must be disabled, move down enabled
    expect((moveUpButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((moveDownButtons[0] as HTMLButtonElement).disabled).toBe(false);

    // Second experience item: move up enabled, move down disabled
    expect((moveUpButtons[1] as HTMLButtonElement).disabled).toBe(false);
    expect((moveDownButtons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows reordering experience items by clicking move buttons', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    const moveDownButtons = container.querySelectorAll('button[aria-label="Move down"]');
    await act(async () => {
      (moveDownButtons[0] as HTMLButtonElement).click();
    });

    // Store state should reflect the swap
    const exps = useResumeGeneratorStore.getState().resume.experience;
    expect(exps[0].id).toBe('exp-2');
    expect(exps[1].id).toBe('exp-1');
  });

  it('supports accordion collapse/expand per item displaying summary header and date pill', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    // Check that company input is initially visible
    expect(container.querySelector('input[value="Google"]')).toBeTruthy();

    // Click collapse on first experience item
    const collapseButtons = container.querySelectorAll('button[aria-label="Collapse"]');
    expect(collapseButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      (collapseButtons[0] as HTMLButtonElement).click();
    });

    // The input should now be hidden
    expect(container.querySelector('input[value="Google"]')).toBeNull();

    // The clean summary header "[Company] — [Role]" and date pill should be shown
    expect(container.textContent).toContain('Google — Staff Engineer');
    expect(container.textContent).toContain('2020 – 2023');

    // Expanding it again restores the input
    const expandButton = container.querySelector('button[aria-label="Expand"]');
    expect(expandButton).toBeTruthy();

    await act(async () => {
      (expandButton as HTMLButtonElement).click();
    });

    expect(container.querySelector('input[value="Google"]')).toBeTruthy();
  });

  it('supports section-level Collapse all and Expand all toggle', async () => {
    await act(async () => {
      root.render(<ResumeEditorPanel />);
    });

    // Initially both inputs are present
    expect(container.querySelector('input[value="Google"]')).toBeTruthy();
    expect(container.querySelector('input[value="DeepMind"]')).toBeTruthy();

    // Find "Collapse all" button in the experience section
    const collapseAllButtons = Array.from(container.querySelectorAll('button')).filter(
      btn => btn.textContent?.trim() === 'Collapse all'
    );
    expect(collapseAllButtons.length).toBeGreaterThanOrEqual(1);

    // Click "Collapse all"
    await act(async () => {
      collapseAllButtons[0].click();
    });

    // Both inputs should now be hidden
    expect(container.querySelector('input[value="Google"]')).toBeNull();
    expect(container.querySelector('input[value="DeepMind"]')).toBeNull();

    // Button should now be "Expand all"
    const expandAllButton = Array.from(container.querySelectorAll('button')).find(
      btn => btn.textContent?.trim() === 'Expand all'
    );
    expect(expandAllButton).toBeTruthy();

    // Click "Expand all"
    await act(async () => {
      expandAllButton?.click();
    });

    // Both inputs restored
    expect(container.querySelector('input[value="Google"]')).toBeTruthy();
    expect(container.querySelector('input[value="DeepMind"]')).toBeTruthy();
  });
});
