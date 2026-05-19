import type { SupportedLocale } from '@/i18n';
import type { ResumeData, ResumeWorkspace } from '@/types/resume';
import { getDefaultResume } from '../data/defaultResume';

export function isStarterResume(resume: ResumeData, locale: SupportedLocale): boolean {
  const starter = getDefaultResume(locale);
  return JSON.stringify(stripVolatileResumeFields(resume)) === JSON.stringify(stripVolatileResumeFields(starter));
}

export function shouldShowFirstRunOnboarding(workspace: Pick<ResumeWorkspace, 'documents' | 'hasDismissedOnboarding'>, locale: SupportedLocale): boolean {
  if (workspace.hasDismissedOnboarding || workspace.documents.length !== 1) return false;
  return isStarterResume(workspace.documents[0].resume, locale);
}

function stripVolatileResumeFields(resume: ResumeData): Omit<ResumeData, 'id'> {
  const { id: _id, ...stableResume } = resume;
  return stableResume;
}