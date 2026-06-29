import { DEFAULT_LOCALE, getCurrentLocale, SUPPORTED_LOCALES, translate, type SupportedLocale } from '@/i18n';
import type { ResumeData, ResumeDocument, ResumeWorkspace } from '@/types/resume';
import { getDefaultResume } from '../data/defaultResume';
import { isStarterResume } from './resumeOnboarding';

export const RESUME_WORKSPACE_STORAGE_KEY = 'resume-generator-workspace';
export const RESUME_WORKSPACE_SCHEMA_VERSION = 1;

type CreateResumeDocumentOptions = {
  id?: string;
  title?: string;
  now?: string;
};

export function loadResumeWorkspace(locale: SupportedLocale = DEFAULT_LOCALE): ResumeWorkspace {
  try {
    const stored = getStorage()?.getItem(RESUME_WORKSPACE_STORAGE_KEY);
    if (!stored) {
      return createDefaultResumeWorkspace(locale);
    }

    const workspace = migrateResumeWorkspace(JSON.parse(stored), locale);
    return rebaseStarterToCurrentLocale(workspace, locale);
  } catch {
    return createDefaultResumeWorkspace(locale);
  }
}

let persistenceFailureNotified = false;

export function saveResumeWorkspace(workspace: ResumeWorkspace): boolean {
  try {
    getStorage()?.setItem(RESUME_WORKSPACE_STORAGE_KEY, JSON.stringify(normalizeResumeWorkspace(workspace)));
    persistenceFailureNotified = false;
    return true;
  } catch {
    // Persistence must never break editing.
    return false;
  }
}

export function shouldNotifyPersistenceFailure(): boolean {
  if (persistenceFailureNotified) return false;
  persistenceFailureNotified = true;
  return true;
}

export function resetPersistenceFailureNotification(): void {
  persistenceFailureNotified = false;
}

export function migrateResumeWorkspace(value: unknown, locale: SupportedLocale = DEFAULT_LOCALE): ResumeWorkspace {
  if (!value || typeof value !== 'object') {
    return createDefaultResumeWorkspace(locale);
  }

  const candidate = value as Partial<ResumeWorkspace>;
  if (candidate.version !== RESUME_WORKSPACE_SCHEMA_VERSION || !Array.isArray(candidate.documents)) {
    return createDefaultResumeWorkspace(locale);
  }

  return normalizeResumeWorkspace({
    version: RESUME_WORKSPACE_SCHEMA_VERSION,
    activeDocumentId: typeof candidate.activeDocumentId === 'string' ? candidate.activeDocumentId : '',
    documents: candidate.documents,
    hasDismissedOnboarding: candidate.hasDismissedOnboarding === true,
  });
}

export function createDefaultResumeWorkspace(locale: SupportedLocale = DEFAULT_LOCALE): ResumeWorkspace {
  const document = createResumeDocument(getDefaultResume(locale));
  return {
    version: RESUME_WORKSPACE_SCHEMA_VERSION,
    activeDocumentId: document.id,
    documents: [document],
    hasDismissedOnboarding: false,
  };
}

export function createResumeDocument(resume: ResumeData, options: CreateResumeDocumentOptions = {}): ResumeDocument {
  const id = options.id || generateResumeDocumentId();
  const now = options.now || new Date().toISOString();
  const clonedResume = cloneResume({
    ...resume,
    id: resume.id || `resume-${id}`,
  });

  return {
    id,
    title: normalizeDocumentTitle(options.title || clonedResume.title),
    resume: clonedResume,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function normalizeResumeWorkspace(workspace: ResumeWorkspace): ResumeWorkspace {
  const documents = workspace.documents
    .filter(isResumeDocumentLike)
    .map(document => ({
      ...document,
      title: normalizeDocumentTitle(document.title || document.resume.title),
      resume: cloneResume(document.resume),
    }));

  if (documents.length === 0) {
    return createDefaultResumeWorkspace(locale);
  }

  const activeDocumentId = documents.some(document => document.id === workspace.activeDocumentId)
    ? workspace.activeDocumentId
    : documents[0].id;

  return {
    version: RESUME_WORKSPACE_SCHEMA_VERSION,
    activeDocumentId,
    documents,
    hasDismissedOnboarding: workspace.hasDismissedOnboarding === true,
  };
}

/**
 * If any document's resume exactly matches a starter sample for a *different*
 * locale, replace its resume data with the sample for the target `locale`.
 *
 * Combined with rebaseResumeIfStarter in setResume + initial + cross-tab,
 * plus auto-correction in LanguageSwitcher (useLayoutEffect), mismatched
 * starters are always silently replaced. The yellow "Content is in ..."
 * banner has been removed because we now guarantee auto-replace.
 */
export function rebaseStarterToCurrentLocale(workspace: ResumeWorkspace, locale: SupportedLocale): ResumeWorkspace {
  const documents = workspace.documents.map(document => {
    const rebasedResume = rebaseResumeIfStarter(document.resume, locale);
    if (rebasedResume === document.resume) {
      return document;
    }
    return {
      ...document,
      resume: rebasedResume,
    };
  });

  return {
    ...workspace,
    documents,
  };
}

export function rebaseResumeIfStarter(resume: ResumeData, locale: SupportedLocale): ResumeData {
  if (isStarterResume(resume, locale)) {
    return resume;
  }
  for (const other of SUPPORTED_LOCALES) {
    if (other !== locale && isStarterResume(resume, other)) {
      return cloneResume(getDefaultResume(locale));
    }
  }
  return resume;
}

export function cloneResume<T extends ResumeData>(resume: T): T {
  return JSON.parse(JSON.stringify(resume)) as T;
}

export function generateResumeDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `doc-${crypto.randomUUID()}`;
  }

  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDocumentTitle(title: string): string {
  return title.trim() || translate(getCurrentLocale(), 'documents.untitled');
}

function isResumeDocumentLike(value: unknown): value is ResumeDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<ResumeDocument>;
  return typeof document.id === 'string'
    && typeof document.title === 'string'
    && typeof document.createdAt === 'string'
    && typeof document.updatedAt === 'string'
    && isResumeDataLike(document.resume);
}

function isResumeDataLike(value: unknown): value is ResumeData {
  if (!value || typeof value !== 'object') return false;
  const resume = value as Partial<ResumeData>;
  return typeof resume.id === 'string'
    && typeof resume.title === 'string'
    && typeof resume.templateId === 'string'
    && Boolean(resume.design)
    && Boolean(resume.personal)
    && Array.isArray(resume.experience)
    && Array.isArray(resume.education)
    && Array.isArray(resume.skills)
    && Array.isArray(resume.projects);
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage as Storage;
  }

  return null;
}