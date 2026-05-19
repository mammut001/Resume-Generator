import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultResume } from '@/features/resume-generator/data/defaultResume';
import { renderResumeToTypst } from '@/features/resume-generator/data/resumeTemplates';
import {
  createDefaultResumeWorkspace,
  createResumeDocument,
  loadResumeWorkspace,
  migrateResumeWorkspace,
  RESUME_WORKSPACE_SCHEMA_VERSION,
  RESUME_WORKSPACE_STORAGE_KEY,
  saveResumeWorkspace,
} from '@/features/resume-generator/lib/resumePersistence';
import { loadResumeVersions } from '@/features/resume-generator/lib/resumeHistory';
import { shouldShowFirstRunOnboarding } from '@/features/resume-generator/lib/resumeOnboarding';

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

describe('resumePersistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a first-run workspace with one default active document', () => {
    const workspace = loadResumeWorkspace('en');

    expect(workspace.version).toBe(RESUME_WORKSPACE_SCHEMA_VERSION);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.activeDocumentId).toBe(workspace.documents[0].id);
    expect(workspace.documents[0].resume.title).toBe(getDefaultResume('en').title);
    expect(workspace.hasDismissedOnboarding).toBe(false);
    expect(shouldShowFirstRunOnboarding(workspace, 'en')).toBe(true);
  });

  it('saves and loads a versioned workspace roundtrip', () => {
    const resume = {
      ...getDefaultResume('en'),
      title: 'Backend Resume',
      personal: {
        ...getDefaultResume('en').personal,
        fullName: 'Jordan Lee',
      },
    };
    const document = createResumeDocument(resume, {
      id: 'doc-backend',
      title: 'Backend Applications',
      now: '2026-05-18T08:00:00.000Z',
    });

    saveResumeWorkspace({
      version: 1,
      activeDocumentId: document.id,
      documents: [document],
      hasDismissedOnboarding: true,
    });

    const loaded = loadResumeWorkspace('en');

    expect(loaded.activeDocumentId).toBe('doc-backend');
    expect(loaded.documents[0].title).toBe('Backend Applications');
    expect(loaded.documents[0].resume.personal.fullName).toBe('Jordan Lee');
    expect(loaded.hasDismissedOnboarding).toBe(true);
    expect(shouldShowFirstRunOnboarding(loaded, 'en')).toBe(false);
  });

  it('recovers from invalid storage with a default workspace', () => {
    localStorage.setItem(RESUME_WORKSPACE_STORAGE_KEY, 'not valid json');

    const workspace = loadResumeWorkspace('zh-CN');

    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0].resume.title).toBe(getDefaultResume('zh-CN').title);
  });

  it('falls back on unsupported schema versions', () => {
    const migrated = migrateResumeWorkspace({
      version: 999,
      activeDocumentId: 'old-doc',
      documents: [],
    }, 'en');

    expect(migrated.version).toBe(1);
    expect(migrated.documents).toHaveLength(1);
    expect(migrated.activeDocumentId).toBe(migrated.documents[0].id);
  });

  it('normalizes a workspace that points at a missing active document', () => {
    const document = createDefaultResumeWorkspace('en').documents[0];

    const workspace = migrateResumeWorkspace({
      version: 1,
      activeDocumentId: 'missing-doc',
      documents: [document],
      hasDismissedOnboarding: false,
    }, 'en');

    expect(workspace.activeDocumentId).toBe(document.id);
  });

  it('does not show onboarding after meaningful resume content exists', () => {
    const resume = {
      ...getDefaultResume('en'),
      summary: 'A real user summary that replaces the starter resume copy.',
    };
    const document = createResumeDocument(resume, { id: 'doc-real', title: 'Real Resume' });

    expect(shouldShowFirstRunOnboarding({ documents: [document], hasDismissedOnboarding: false }, 'en')).toBe(false);
  });
});

describe('resumeGeneratorStore document workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('creates documents and makes the new document active', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const initialDocumentCount = useResumeGeneratorStore.getState().documents.length;

    useResumeGeneratorStore.getState().createDocument();
    const state = useResumeGeneratorStore.getState();

    expect(state.documents).toHaveLength(initialDocumentCount + 1);
    expect(state.documents.some(document => document.id === state.activeDocumentId)).toBe(true);
    expect(loadResumeWorkspace('en').activeDocumentId).toBe(state.activeDocumentId);
  });

  it('persists onboarding dismissal across reloads', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    useResumeGeneratorStore.getState().dismissOnboarding();

    expect(useResumeGeneratorStore.getState().hasDismissedOnboarding).toBe(true);
    expect(loadResumeWorkspace('en').hasDismissedOnboarding).toBe(true);
  });

  it('duplicates the active document and preserves the resume payload', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    useResumeGeneratorStore.getState().updatePersonal({ fullName: 'Jordan Lee' });
    useResumeGeneratorStore.getState().duplicateDocument();
    const state = useResumeGeneratorStore.getState();
    const activeDocument = state.documents.find(document => document.id === state.activeDocumentId);

    expect(state.documents).toHaveLength(2);
    expect(activeDocument?.title).toContain('Copy');
    expect(activeDocument?.resume.personal.fullName).toBe('Jordan Lee');
    expect(activeDocument?.id).not.toBe(state.documents[0].id);
  });

  it('renames the document label without mutating the resume title', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const state = useResumeGeneratorStore.getState();
    const originalResumeTitle = state.resume.title;

    state.renameDocument(state.activeDocumentId, 'Frontend Applications');
    const nextState = useResumeGeneratorStore.getState();

    expect(nextState.documents.find(document => document.id === nextState.activeDocumentId)?.title).toBe('Frontend Applications');
    expect(nextState.resume.title).toBe(originalResumeTitle);
  });

  it('switches documents and restores each resume payload', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const firstDocumentId = useResumeGeneratorStore.getState().activeDocumentId;

    useResumeGeneratorStore.getState().updatePersonal({ fullName: 'First Candidate' });
    useResumeGeneratorStore.getState().createDocument();
    const secondDocumentId = useResumeGeneratorStore.getState().activeDocumentId;
    useResumeGeneratorStore.getState().updatePersonal({ fullName: 'Second Candidate' });

    useResumeGeneratorStore.getState().switchDocument(firstDocumentId);
    expect(useResumeGeneratorStore.getState().resume.personal.fullName).toBe('First Candidate');

    useResumeGeneratorStore.getState().switchDocument(secondDocumentId);
    expect(useResumeGeneratorStore.getState().resume.personal.fullName).toBe('Second Candidate');
  });

  it('deletes inactive and active documents without ending with zero documents', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    useResumeGeneratorStore.getState().createDocument();
    const stateWithTwoDocuments = useResumeGeneratorStore.getState();
    const inactiveDocumentId = stateWithTwoDocuments.documents.find(document => document.id !== stateWithTwoDocuments.activeDocumentId)?.id;
    expect(inactiveDocumentId).toBeTruthy();

    useResumeGeneratorStore.getState().deleteDocument(inactiveDocumentId!);
    expect(useResumeGeneratorStore.getState().documents).toHaveLength(1);

    const onlyDocumentId = useResumeGeneratorStore.getState().activeDocumentId;
    useResumeGeneratorStore.getState().deleteDocument(onlyDocumentId);
    const finalState = useResumeGeneratorStore.getState();

    expect(finalState.documents).toHaveLength(1);
    expect(finalState.activeDocumentId).toBe(onlyDocumentId);
  });

  it('deletes the active document by switching to another remaining document', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const firstDocumentId = useResumeGeneratorStore.getState().activeDocumentId;

    useResumeGeneratorStore.getState().createDocument();
    const secondDocumentId = useResumeGeneratorStore.getState().activeDocumentId;
    useResumeGeneratorStore.getState().deleteDocument(secondDocumentId);

    const state = useResumeGeneratorStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.activeDocumentId).toBe(firstDocumentId);
  });

  it('autosaves resume edits, design changes, and template changes without version spam', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');

    useResumeGeneratorStore.getState().updatePersonal({ fullName: 'Persistent Candidate' });
    useResumeGeneratorStore.getState().updateDesign({ accentColor: '#0f766e' });
    useResumeGeneratorStore.getState().setTemplate('modern-compact');

    const persisted = loadResumeWorkspace('en');
    const activeDocument = persisted.documents.find(document => document.id === persisted.activeDocumentId);

    expect(activeDocument?.resume.personal.fullName).toBe('Persistent Candidate');
    expect(activeDocument?.resume.design.accentColor).toBe('#0f766e');
    expect(activeDocument?.resume.templateId).toBe('modern-compact');
    expect(loadResumeVersions()).toHaveLength(1);
  });

  it('persists an applied imported draft through setResume', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const draftResume = {
      ...getDefaultResume('en'),
      title: 'Imported Resume',
      personal: {
        ...getDefaultResume('en').personal,
        fullName: 'Imported Candidate',
      },
    };

    useResumeGeneratorStore.getState().setResume(draftResume);

    const persisted = loadResumeWorkspace('en');
    const activeDocument = persisted.documents.find(document => document.id === persisted.activeDocumentId);

    expect(activeDocument?.resume.personal.fullName).toBe('Imported Candidate');
    expect(useResumeGeneratorStore.getState().typstSource).toBe(renderResumeToTypst(useResumeGeneratorStore.getState().resume, useResumeGeneratorStore.getState().resume.templateId));
  });

  it('creates a persisted active document from a tailored resume without mutating the source', async () => {
    const { useResumeGeneratorStore } = await import('@/features/resume-generator/store/resumeGeneratorStore');
    const sourceSummary = useResumeGeneratorStore.getState().resume.summary;
    const tailoredResume = {
      ...useResumeGeneratorStore.getState().resume,
      id: 'tailored-platform',
      summary: 'Tailored summary focused on platform engineering.',
    };

    useResumeGeneratorStore.getState().createDocumentFromResume('Tailored Platform Resume', tailoredResume);

    const state = useResumeGeneratorStore.getState();
    const persisted = loadResumeWorkspace('en');

    expect(state.documents).toHaveLength(2);
    expect(state.documents[0].resume.summary).toBe(sourceSummary);
    expect(state.activeDocumentId).toBe(state.documents[1].id);
    expect(state.resume.summary).toBe('Tailored summary focused on platform engineering.');
    expect(persisted.documents).toHaveLength(2);
    expect(persisted.documents.find(document => document.id === persisted.activeDocumentId)?.title).toBe('Tailored Platform Resume');
  });
});