import { describe, expect, it } from 'vitest';
import { defaultResume } from '@/features/resume-generator/data/defaultResume';
import { buildResumeExportFileName } from '@/features/resume-generator/lib/exportResume';
import { getExportReadiness } from '@/features/resume-generator/lib/exportReadiness';

describe('resume export helpers', () => {
  it('generates stable slugified PDF and Typst filenames', () => {
    const resume = {
      ...defaultResume,
      personal: {
        ...defaultResume.personal,
        fullName: 'Alex Chen',
      },
    };

    expect(buildResumeExportFileName(resume, 'pdf')).toBe('alex-chen-frontend-engineer-resume.pdf');
    expect(buildResumeExportFileName(resume, 'typ')).toBe('alex-chen-frontend-engineer-resume.typ');
  });

  it('preserves useful tailored document context in filenames', () => {
    expect(buildResumeExportFileName(defaultResume, 'pdf', 'Frontend Engineer Resume - Tailored for Frontend Platform Engineer'))
      .toBe('alex-chen-frontend-engineer-resume-tailored-for-frontend-platform-engineer.pdf');
  });

  it('uses a safe fallback filename when identity fields are missing', () => {
    const resume = {
      ...defaultResume,
      title: '',
      personal: {
        ...defaultResume.personal,
        fullName: '',
        headline: '',
      },
    };

    expect(buildResumeExportFileName(resume, 'pdf')).toBe('resume.pdf');
  });

  it('reports readiness checks without blocking export', () => {
    const readiness = getExportReadiness({
      ...defaultResume,
      personal: {
        ...defaultResume.personal,
        fullName: '',
        email: '',
      },
      summary: '',
      experience: [],
      education: [],
      skills: [],
    });

    expect(readiness.status).toBe('review');
    expect(readiness.issues.map(issue => issue.code)).toEqual([
      'missing_name',
      'missing_email',
      'empty_summary',
      'no_experience',
      'no_education',
      'no_skills',
    ]);
  });
});