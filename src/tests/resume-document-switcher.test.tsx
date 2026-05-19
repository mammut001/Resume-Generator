// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import { ResumeDocumentSwitcher } from '@/features/resume-generator/components/ResumeDocumentSwitcher';
import { createResumeDocument } from '@/features/resume-generator/lib/resumePersistence';
import { useResumeGeneratorStore } from '@/features/resume-generator/store/resumeGeneratorStore';
import { useLocaleStore } from '@/i18n';

describe('ResumeDocumentSwitcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    useLocaleStore.getState().setLocale('en');
    resetStoreWithTwoDocuments();

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
  });

  it('renders the current document title and creates a new active document', async () => {
    await renderSwitcher();

    expect(container.textContent).toContain('Frontend Resume');

    const createButton = getButtonByLabel('Create resume');
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const state = useResumeGeneratorStore.getState();
    expect(state.documents).toHaveLength(3);
    expect(state.documents.find(document => document.id === state.activeDocumentId)?.title).toBe(getDefaultResume('en').title);
  });

  it('switches documents and changes visible resume data', async () => {
    await renderSwitcher();

    await act(async () => {
      useResumeGeneratorStore.getState().switchDocument('doc-design');
    });
    await renderSwitcher();

    expect(container.textContent).toContain('Design Resume');
    expect(useResumeGeneratorStore.getState().resume.personal.fullName).toBe('Design Candidate');
  });

  it('duplicates, renames, and confirms deletion of the active document safely', async () => {
    await renderSwitcher();

    const duplicateButton = getButtonByLabel('Duplicate current resume');
    await act(async () => {
      duplicateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    let state = useResumeGeneratorStore.getState();
    expect(state.documents).toHaveLength(3);
    expect(state.documents.find(document => document.id === state.activeDocumentId)?.title).toContain('Copy');

    await renderSwitcher();
    const titleInput = container.querySelector('input[aria-label="Document title"]') as HTMLInputElement;
    const inputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      inputValueSetter?.call(titleInput, 'Research Resume');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      getButtonByLabel('Rename resume document').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    state = useResumeGeneratorStore.getState();
    expect(state.documents.find(document => document.id === state.activeDocumentId)?.title).toBe('Research Resume');
    expect(state.resume.title).not.toBe('Research Resume');

    const deleteButton = getButtonByLabel('Delete resume document');
    await act(async () => {
      deleteButton.click();
    });

    expect(document.body.textContent).toContain('Delete “Research Resume”?');
    expect(document.body.textContent).toContain('This removes it from this browser. Your other resumes will stay available.');

    await act(async () => {
      getBodyButtonExact('Cancel').click();
    });

    state = useResumeGeneratorStore.getState();
    expect(state.documents).toHaveLength(3);

    await act(async () => {
      deleteButton.click();
    });
    await act(async () => {
      getBodyButtonExact('Delete resume').click();
    });

    state = useResumeGeneratorStore.getState();
    expect(state.documents).toHaveLength(2);
    expect(state.documents.some(document => document.id === state.activeDocumentId)).toBe(true);
  });

  it('keeps single-document deletion blocked', async () => {
    resetStoreWithOneDocument();
    await renderSwitcher();

    const deleteButton = getButtonByLabel('Delete resume document');

    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.getAttribute('title')).toBe('Keep at least one resume document');
    expect(container.textContent).toContain('Local only');
    expect(container.textContent).toContain('Saved in this browser on this device.');
  });

  it('tracks deletion without logging private document titles', async () => {
    localStorage.setItem('resume-generator-analytics-debug', '1');
    const analyticsInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await renderSwitcher();

    await act(async () => {
      getButtonByLabel('Delete resume document').click();
    });
    await act(async () => {
      getBodyButtonExact('Delete resume').click();
    });

    expect(analyticsInfo).toHaveBeenCalledWith('[analytics]', {
      event: 'document_deleted',
      payload: { documentCount: 1 },
    });
    expect(JSON.stringify(analyticsInfo.mock.calls)).not.toContain('Frontend Resume');
  });

  async function renderSwitcher() {
    await act(async () => {
      root.render(<ResumeDocumentSwitcher />);
    });
  }

  function getButtonByLabel(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(label) || candidate.getAttribute('title') === label) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }

  function getBodyButtonExact(text: string): HTMLButtonElement {
    const button = Array.from(document.body.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === text) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();
    return button!;
  }
});

function resetStoreWithTwoDocuments() {
  const frontendResume = {
    ...getDefaultResume('en'),
    personal: {
      ...getDefaultResume('en').personal,
      fullName: 'Frontend Candidate',
    },
  };
  const designResume = {
    ...getDefaultResume('en'),
    personal: {
      ...getDefaultResume('en').personal,
      fullName: 'Design Candidate',
    },
  };
  const frontendDocument = createResumeDocument(frontendResume, {
    id: 'doc-frontend',
    title: 'Frontend Resume',
    now: '2026-05-18T08:00:00.000Z',
  });
  const designDocument = createResumeDocument(designResume, {
    id: 'doc-design',
    title: 'Design Resume',
    now: '2026-05-18T08:01:00.000Z',
  });

  useResumeGeneratorStore.setState({
    ...useResumeGeneratorStore.getState(),
    documents: [frontendDocument, designDocument],
    activeDocumentId: frontendDocument.id,
    resume: frontendDocument.resume,
    typstSource: renderResumeToTypst(frontendDocument.resume, frontendDocument.resume.templateId, 'en'),
    versions: [],
    renderStatus: 'idle',
    renderError: null,
    svgHtml: null,
  });
}

function resetStoreWithOneDocument() {
  const resume = {
    ...getDefaultResume('en'),
    personal: {
      ...getDefaultResume('en').personal,
      fullName: 'Solo Candidate',
    },
  };
  const document = createResumeDocument(resume, {
    id: 'doc-solo',
    title: 'Solo Resume',
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