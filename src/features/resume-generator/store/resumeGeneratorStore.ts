import { create } from 'zustand';
import { getCurrentLocale, LOCALE_LABELS, translate, useLocaleStore } from '@/i18n';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { toast } from 'sonner';
import { ResumeData, ResumeDocument, ResumeIntakeWarning, ResumeVersion, ResumeWorkspace } from '@/types/resume';
import { getDefaultResume } from '../data/defaultResume';
import { loadResumeVersions, saveResumeVersion } from '../lib/resumeHistory';
import { renderResumeToTypst } from '../data/resumeTemplates';
import { resumeDesignDefaults } from '../data/resumeDesign';
import { cloneResume, createResumeDocument, loadResumeWorkspace, saveResumeWorkspace } from '../lib/resumePersistence';
import { isStarterResume } from '../lib/resumeOnboarding';

type RenderStatus = 'idle' | 'rendering' | 'success' | 'error';

interface ResumeGeneratorState {
  documents: ResumeDocument[];
  activeDocumentId: string;
  resume: ResumeData;
  typstSource: string;
  renderStatus: RenderStatus;
  renderError: string | null;
  svgHtml: string | null;
  lastIntakeWarnings: ResumeIntakeWarning[];
  versions: ResumeVersion[];
  hasDismissedOnboarding: boolean;

  // Actions
  setResume: (resume: ResumeData) => void;
  updatePersonal: (personal: Partial<ResumeData['personal']>) => void;
  updateSummary: (summary: string) => void;
  setTemplate: (templateId: string) => void;
  updateDesign: (design: Partial<ResumeData['design']>) => void;
  addExperience: () => void;
  updateExperience: (id: string, updates: Partial<ResumeData['experience'][0]>) => void;
  removeExperience: (id: string) => void;
  addEducation: () => void;
  updateEducation: (id: string, updates: Partial<ResumeData['education'][0]>) => void;
  removeEducation: (id: string) => void;
  addSkill: () => void;
  updateSkill: (id: string, updates: Partial<ResumeData['skills'][0]>) => void;
  removeSkill: (id: string) => void;
  addProject: () => void;
  updateProject: (id: string, updates: Partial<ResumeData['projects'][0]>) => void;
  removeProject: (id: string) => void;
  setSvgHtml: (html: string | null) => void;
  setRenderStatus: (status: RenderStatus, error?: string) => void;
  setLastIntakeWarnings: (warnings: ResumeIntakeWarning[]) => void;
  clearLastIntakeWarnings: () => void;
  createDocument: () => void;
  duplicateDocument: () => void;
  createDocumentFromResume: (title: string, resume: ResumeData) => void;
  renameDocument: (id: string, title: string) => void;
  deleteDocument: (id: string) => void;
  switchDocument: (id: string) => void;
  dismissOnboarding: () => void;
  saveActiveDocument: (resume?: ResumeData) => void;
  setVersions: (versions: ResumeVersion[]) => void;
  saveVersion: (label?: string) => void;
  restoreVersion: (version: ResumeVersion) => void;
  deleteVersion: (id: string) => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function normalizeResume(resume: ResumeData, fallbackDesign = resumeDesignDefaults): ResumeData {
  return {
    ...resume,
    design: {
      ...resumeDesignDefaults,
      ...fallbackDesign,
      ...(resume as Partial<ResumeData>).design,
    },
  };
}

const initialLocale = useLocaleStore.getState().locale;
const initialWorkspace = loadResumeWorkspace(initialLocale);
const initialDocument = getActiveDocument(initialWorkspace) || createResumeDocument(getDefaultResume(initialLocale));
const initialResume = normalizeResume(initialDocument.resume);

function renderResumeSource(resume: ResumeData): string {
  return renderResumeToTypst(resume, resume.templateId, getCurrentLocale());
}

function getActiveDocument(workspace: Pick<ResumeWorkspace, 'activeDocumentId' | 'documents'>): ResumeDocument | undefined {
  return workspace.documents.find(document => document.id === workspace.activeDocumentId) || workspace.documents[0];
}

function getDocumentLabel(resume: ResumeData): string {
  return resume.title.trim() || resume.personal.fullName.trim() || 'Untitled Resume';
}

function getCopyTitle(title: string, documents: ResumeDocument[]): string {
  const baseTitle = `${title.trim() || 'Untitled Resume'} Copy`;
  const existingTitles = new Set(documents.map(document => document.title));
  if (!existingTitles.has(baseTitle)) return baseTitle;

  let copyNumber = 2;
  while (existingTitles.has(`${baseTitle} ${copyNumber}`)) {
    copyNumber += 1;
  }

  return `${baseTitle} ${copyNumber}`;
}

function persistWorkspaceState(documents: ResumeDocument[], activeDocumentId: string, hasDismissedOnboarding: boolean): void {
  saveResumeWorkspace({
    version: 1,
    activeDocumentId,
    documents,
    hasDismissedOnboarding,
  });
}

export const useResumeGeneratorStore = create<ResumeGeneratorState>((set, get) => ({
  documents: initialWorkspace.documents,
  activeDocumentId: initialDocument.id,
  resume: initialResume,
  typstSource: renderResumeSource(initialResume),
  renderStatus: 'idle',
  renderError: null,
  svgHtml: null,
  lastIntakeWarnings: [],
  versions: loadResumeVersions(),
  hasDismissedOnboarding: initialWorkspace.hasDismissedOnboarding,

  setResume: (resume) => {
    const normalized = normalizeResume(resume, get().resume.design);
    const typstSource = renderResumeSource(normalized);
    get().saveActiveDocument(normalized);
    set({ resume: normalized, typstSource });
  },

  updatePersonal: (personal) => {
    const { resume } = get();
    const updated = {
      ...resume,
      personal: { ...resume.personal, ...personal },
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  updateSummary: (summary) => {
    const { resume } = get();
    const updated = { ...resume, summary };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  setTemplate: (templateId) => {
    const { resume } = get();
    if (resume.templateId === templateId) return;

    const updated = { ...resume, templateId };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
    get().saveVersion(translate(getCurrentLocale(), 'versionHistory.templateChangeLabel'));
  },

  updateDesign: (design) => {
    const { resume } = get();
    const updated = {
      ...resume,
      design: { ...resume.design, ...design },
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  addExperience: () => {
    const { resume } = get();
    const newExp = {
      id: generateId(),
      company: '',
      role: '',
      startDate: '',
      endDate: '',
      current: false,
      bullets: [''],
    };
    const updated = { ...resume, experience: [...resume.experience, newExp] };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  updateExperience: (id, updates) => {
    const { resume } = get();
    const updated = {
      ...resume,
      experience: resume.experience.map(exp =>
        exp.id === id ? { ...exp, ...updates } : exp
      ),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  removeExperience: (id) => {
    const { resume } = get();
    const updated = {
      ...resume,
      experience: resume.experience.filter(exp => exp.id !== id),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  addEducation: () => {
    const { resume } = get();
    const newEdu = {
      id: generateId(),
      school: '',
      degree: '',
    };
    const updated = { ...resume, education: [...resume.education, newEdu] };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  updateEducation: (id, updates) => {
    const { resume } = get();
    const updated = {
      ...resume,
      education: resume.education.map(edu =>
        edu.id === id ? { ...edu, ...updates } : edu
      ),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  removeEducation: (id) => {
    const { resume } = get();
    const updated = {
      ...resume,
      education: resume.education.filter(edu => edu.id !== id),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  addSkill: () => {
    const { resume } = get();
    const newSkill = {
      id: generateId(),
      category: '',
      items: [''],
    };
    const updated = { ...resume, skills: [...resume.skills, newSkill] };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  updateSkill: (id, updates) => {
    const { resume } = get();
    const updated = {
      ...resume,
      skills: resume.skills.map(skill =>
        skill.id === id ? { ...skill, ...updates } : skill
      ),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  removeSkill: (id) => {
    const { resume } = get();
    const updated = {
      ...resume,
      skills: resume.skills.filter(skill => skill.id !== id),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  addProject: () => {
    const { resume } = get();
    const newProj = {
      id: generateId(),
      name: '',
      description: '',
      bullets: [''],
    };
    const updated = { ...resume, projects: [...resume.projects, newProj] };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  updateProject: (id, updates) => {
    const { resume } = get();
    const updated = {
      ...resume,
      projects: resume.projects.map(proj =>
        proj.id === id ? { ...proj, ...updates } : proj
      ),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  removeProject: (id) => {
    const { resume } = get();
    const updated = {
      ...resume,
      projects: resume.projects.filter(proj => proj.id !== id),
    };
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource });
  },

  setSvgHtml: (svgHtml) => set({ svgHtml }),

  setRenderStatus: (status, error) =>
    set({ renderStatus: status, renderError: error || null }),

  setLastIntakeWarnings: (warnings) => set({
    lastIntakeWarnings: warnings.map(warning => ({ ...warning })),
  }),

  clearLastIntakeWarnings: () => set({ lastIntakeWarnings: [] }),

  createDocument: () => {
    const now = new Date().toISOString();
    const document = createResumeDocument(getDefaultResume(getCurrentLocale()), { now });
    const updatedDocuments = [...get().documents, document];
    persistWorkspaceState(updatedDocuments, document.id, get().hasDismissedOnboarding);
    trackAnalyticsEvent('document_created', { source: 'blank', documentCount: updatedDocuments.length });
    const resume = normalizeResume(document.resume);
    set({
      documents: updatedDocuments,
      activeDocumentId: document.id,
      resume,
      typstSource: renderResumeSource(resume),
      svgHtml: null,
      renderStatus: 'idle',
      renderError: null,
      lastIntakeWarnings: [],
    });
  },

  duplicateDocument: () => {
    const { documents, activeDocumentId, resume } = get();
    const activeDocument = documents.find(document => document.id === activeDocumentId) || documents[0];
    const title = getCopyTitle(activeDocument?.title || getDocumentLabel(resume), documents);
    const duplicatedResume = cloneResume({
      ...resume,
      id: generateId(),
    });
    const document = createResumeDocument(duplicatedResume, { title });
    const updatedDocuments = [...documents, document];
    persistWorkspaceState(updatedDocuments, document.id, get().hasDismissedOnboarding);
    trackAnalyticsEvent('document_duplicated', { documentCount: updatedDocuments.length });
    const normalized = normalizeResume(document.resume);
    set({
      documents: updatedDocuments,
      activeDocumentId: document.id,
      resume: normalized,
      typstSource: renderResumeSource(normalized),
      svgHtml: null,
      renderStatus: 'idle',
      renderError: null,
      lastIntakeWarnings: [],
    });
  },

  createDocumentFromResume: (title, resume) => {
    const sourceResume = get().resume;
    const normalized = normalizeResume({
      ...resume,
      id: resume.id && resume.id !== sourceResume.id ? resume.id : generateId(),
    }, sourceResume.design);
    const document = createResumeDocument(normalized, { title });
    const updatedDocuments = [...get().documents, document];
    persistWorkspaceState(updatedDocuments, document.id, get().hasDismissedOnboarding);
    trackAnalyticsEvent('document_created', { source: 'tailoring', documentCount: updatedDocuments.length });
    set({
      documents: updatedDocuments,
      activeDocumentId: document.id,
      resume: normalized,
      typstSource: renderResumeSource(normalized),
      svgHtml: null,
      renderStatus: 'idle',
      renderError: null,
      lastIntakeWarnings: [],
    });
  },

  renameDocument: (id, title) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;

    const now = new Date().toISOString();
    const documents = get().documents.map(document => document.id === id
      ? { ...document, title: normalizedTitle, updatedAt: now }
      : document);
    persistWorkspaceState(documents, get().activeDocumentId, get().hasDismissedOnboarding);
    set({ documents });
  },

  deleteDocument: (id) => {
    const { documents, activeDocumentId } = get();
    if (documents.length <= 1) return;

    const remainingDocuments = documents.filter(document => document.id !== id);
    const nextActiveDocumentId = id === activeDocumentId ? remainingDocuments[0].id : activeDocumentId;
    const activeDocument = remainingDocuments.find(document => document.id === nextActiveDocumentId) || remainingDocuments[0];
    const resume = normalizeResume(activeDocument.resume);
    persistWorkspaceState(remainingDocuments, activeDocument.id, get().hasDismissedOnboarding);
    trackAnalyticsEvent('document_deleted', { documentCount: remainingDocuments.length });
    set({
      documents: remainingDocuments,
      activeDocumentId: activeDocument.id,
      resume,
      typstSource: renderResumeSource(resume),
      svgHtml: null,
      renderStatus: 'idle',
      renderError: null,
      lastIntakeWarnings: [],
    });
  },

  switchDocument: (id) => {
    const { documents } = get();
    const activeDocument = documents.find(document => document.id === id);
    if (!activeDocument) return;

    const now = new Date().toISOString();
    const updatedDocuments = documents.map(document => document.id === id
      ? { ...document, lastOpenedAt: now }
      : document);
    const resume = normalizeResume(activeDocument.resume);
    persistWorkspaceState(updatedDocuments, id, get().hasDismissedOnboarding);
    set({
      documents: updatedDocuments,
      activeDocumentId: id,
      resume,
      typstSource: renderResumeSource(resume),
      svgHtml: null,
      renderStatus: 'idle',
      renderError: null,
      lastIntakeWarnings: [],
    });
  },

  dismissOnboarding: () => {
    const { documents, activeDocumentId } = get();
    persistWorkspaceState(documents, activeDocumentId, true);
    set({ hasDismissedOnboarding: true });
  },

  saveActiveDocument: (nextResume) => {
    const { documents, activeDocumentId, resume } = get();
    const activeResume = normalizeResume(nextResume || resume, resume.design);
    const now = new Date().toISOString();
    const updatedDocuments = documents.map(document => document.id === activeDocumentId
      ? {
          ...document,
          resume: cloneResume(activeResume),
          updatedAt: now,
          lastOpenedAt: now,
        }
      : document);
    persistWorkspaceState(updatedDocuments, activeDocumentId, get().hasDismissedOnboarding);
    set({ documents: updatedDocuments });
  },

  setVersions: (versions) => set({ versions }),

  saveVersion: (label) => {
    const { resume, typstSource } = get();
    const version: ResumeVersion = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      label: label || translate(getCurrentLocale(), 'versionHistory.manualSaveLabel'),
      resume: JSON.parse(JSON.stringify(resume)),
      typstSource,
    };
    saveResumeVersion(version);
    set(state => ({ versions: [version, ...state.versions].slice(0, 50) }));
  },

  restoreVersion: (version) => {
    const updated = normalizeResume(JSON.parse(JSON.stringify(version.resume)), get().resume.design);
    const typstSource = renderResumeSource(updated);
    get().saveActiveDocument(updated);
    set({ resume: updated, typstSource, lastIntakeWarnings: [] });
    get().saveVersion(translate(getCurrentLocale(), 'versionHistory.restoredLabel', { label: version.label }));
  },

  deleteVersion: (id) => {
    const { versions } = get();
    const filtered = versions.filter(v => v.id !== id);
    set({ versions: filtered });
    // Also delete from storage
    try {
      const stored = JSON.parse(localStorage.getItem('resume-generator-versions') || '[]');
      const newStored = stored.filter((v: ResumeVersion) => v.id !== id);
      localStorage.setItem('resume-generator-versions', JSON.stringify(newStored));
    } catch {
      // Version storage cleanup is best-effort.
    }
  },

}))

useLocaleStore.subscribe((state, previousState) => {
  if (state.locale === previousState.locale) {
    return;
  }

  const current = useResumeGeneratorStore.getState();
  if (isStarterResume(current.resume, previousState.locale)) {
    const nextResume = getDefaultResume(state.locale);
    current.setResume(nextResume);
    toast.success(translate(state.locale, 'toast.localeSampleLoaded'), {
      description: translate(state.locale, 'toast.localeSampleDescription'),
    });
    return;
  }

  useResumeGeneratorStore.setState({
    typstSource: renderResumeToTypst(current.resume, current.resume.templateId, state.locale),
  });
  // The user has already edited the resume, so we don't silently overwrite
  // their work. Surface the "interface only" behavior and offer a one-click
  // "swap to the localized sample" path so users who expect the resume
  // content to translate can still get that with a single click.
  const localeLabel = LOCALE_LABELS[state.locale];
  toast.info(
    translate(state.locale, 'toast.localeInterfaceOnlyTitle', { locale: localeLabel }),
    {
      description: translate(state.locale, 'toast.localeInterfaceOnlyDescription'),
      duration: Number.POSITIVE_INFINITY,
      dismissible: true,
      action: {
        label: translate(state.locale, 'toast.localeLoadSampleAction', { locale: localeLabel }),
        onClick: () => {
          const nextResume = getDefaultResume(state.locale);
          useResumeGeneratorStore.getState().setResume(nextResume);
          toast.success(translate(state.locale, 'toast.localeSampleLoaded'), {
            description: translate(state.locale, 'toast.localeSampleDescription'),
          });
        },
    },
  });
});
