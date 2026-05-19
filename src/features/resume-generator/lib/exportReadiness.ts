import type { ResumeData } from '@/types/resume';

export type ExportReadinessIssueCode = 'missing_name' | 'missing_email' | 'empty_summary' | 'no_experience' | 'no_education' | 'no_skills';

export type ExportReadinessIssue = {
  code: ExportReadinessIssueCode;
  severity: 'check' | 'important';
};

export type ExportReadiness = {
  status: 'ready' | 'review';
  issues: ExportReadinessIssue[];
};

export function getExportReadiness(resume: ResumeData): ExportReadiness {
  const issues: ExportReadinessIssue[] = [];

  if (!resume.personal.fullName.trim()) issues.push({ code: 'missing_name', severity: 'important' });
  if (!resume.personal.email.trim()) issues.push({ code: 'missing_email', severity: 'check' });
  if (!resume.summary.trim()) issues.push({ code: 'empty_summary', severity: 'check' });
  if (resume.experience.length === 0) issues.push({ code: 'no_experience', severity: 'check' });
  if (resume.education.length === 0) issues.push({ code: 'no_education', severity: 'check' });
  if (resume.skills.length === 0 || resume.skills.every(group => group.items.length === 0)) issues.push({ code: 'no_skills', severity: 'check' });

  return {
    status: issues.length === 0 ? 'ready' : 'review',
    issues,
  };
}