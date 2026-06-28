// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignSection } from '@/features/resume-generator/components/ResumeEditorPanel';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DesignSection', () => {
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
  });

  it('renders readable template names and accessible segmented controls', async () => {
    await act(async () => {
      root.render(<DesignSection />);
    });

    expect(container.textContent).toContain('Basic Resume');
    expect(container.textContent).toContain('Brilliant CV');
    expect(container.querySelector('[role="group"][aria-label="Typography"]')).toBeTruthy();
    expect(container.querySelector('button[aria-pressed="true"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label][aria-pressed]')).toBeTruthy();
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
    renderStatus: 'success',
    renderError: null,
    svgHtml: '<svg />',
    lastIntakeWarnings: [],
    versions: [],
    hasDismissedOnboarding: true,
  });
}