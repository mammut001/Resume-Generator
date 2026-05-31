import { describe, expect, it } from 'vitest';
import { defaultResume } from '@/features/resume-generator/data/defaultResume';
import { analyzeExportReadiness, type AnalyzeExportReadinessInput } from '@/features/resume-generator/lib/exportReadiness';
import type { ResumeData } from '@/types/resume';

function cloneResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    ...(JSON.parse(JSON.stringify(defaultResume)) as ResumeData),
    templateId: 'basic-resume',
    ...overrides,
  };
}

function analyze(overrides: Partial<AnalyzeExportReadinessInput> = {}) {
  return analyzeExportReadiness({
    resume: cloneResume(),
    typstSource: '#let resume = (:)',
    renderStatus: 'success',
    renderError: null,
    svgHtml: '<svg />',
    templateIds: ['basic-resume', 'brilliant-cv', 'rendercv'],
    ...overrides,
  });
}

function issueCodes(report: ReturnType<typeof analyzeExportReadiness>) {
  return report.issues.map(issue => issue.code);
}

describe('analyzeExportReadiness', () => {
  it('returns ready with a high score for a complete resume', () => {
    const report = analyze();

    expect(report.level).toBe('ready');
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
    expect(issueCodes(report)).toEqual([]);
  });

  it('returns a blocker when the name is missing', () => {
    const resume = cloneResume({ personal: { ...defaultResume.personal, fullName: '' } });
    const report = analyze({ resume });

    expect(report.level).toBe('blocked');
    expect(issueCodes(report)).toContain('MISSING_NAME');
    expect(report.summary.blockerCount).toBeGreaterThan(0);
  });

  it('returns blockers for missing and invalid email', () => {
    const missingEmail = analyze({ resume: cloneResume({ personal: { ...defaultResume.personal, email: '' } }) });
    const invalidEmail = analyze({ resume: cloneResume({ personal: { ...defaultResume.personal, email: 'not-an-email' } }) });

    expect(issueCodes(missingEmail)).toContain('MISSING_EMAIL');
    expect(issueCodes(invalidEmail)).toContain('INVALID_EMAIL');
    expect(missingEmail.level).toBe('blocked');
    expect(invalidEmail.level).toBe('blocked');
  });

  it('returns a blocker when rendering has failed', () => {
    const report = analyze({ renderStatus: 'error', renderError: 'Typst failed' });

    expect(report.level).toBe('blocked');
    expect(issueCodes(report)).toContain('RENDER_ERROR');
  });

  it('flags a short summary as a suggestion', () => {
    const report = analyze({ resume: cloneResume({ summary: 'Too short.' }) });
    const issue = report.issues.find(candidate => candidate.code === 'SUMMARY_TOO_SHORT');

    expect(report.level).toBe('needs_review');
    expect(issue?.severity).toBe('suggestion');
  });

  it('flags an overly long experience bullet as a warning', () => {
    const longBullet = 'Improved customer onboarding by coordinating product, design, and engineering work across multiple surfaces while documenting every implementation detail in a single bullet that is intentionally too long for a resume and should be tightened before export because it will be hard to scan quickly.';
    const resume = cloneResume({
      experience: [{ ...defaultResume.experience[0], bullets: [longBullet] }],
    });
    const report = analyze({ resume });
    const issue = report.issues.find(candidate => candidate.code === 'EXPERIENCE_BULLET_TOO_LONG');

    expect(issue?.severity).toBe('warning');
    expect(report.score).toBeLessThan(100);
  });

  it('flags suspicious URLs', () => {
    const resume = cloneResume({
      personal: {
        ...defaultResume.personal,
        linkedin: 'linkedin.com/company/not-a-person',
        github: 'github.com',
        website: 'portfolio',
      },
    });
    const report = analyze({ resume });

    expect(issueCodes(report)).toContain('LINKEDIN_URL_SUSPICIOUS');
    expect(issueCodes(report)).toContain('GITHUB_URL_SUSPICIOUS');
    expect(issueCodes(report)).toContain('WEBSITE_URL_SUSPICIOUS');
  });

  it('includes intake warnings as readiness warnings', () => {
    const report = analyze({
      intakeWarnings: [{ code: 'PDF_USED_OCR', message: 'OCR was used', fieldPath: 'summary' }],
    });
    const issue = report.issues.find(candidate => candidate.code === 'INTAKE_PDF_USED_OCR');

    expect(report.level).toBe('needs_review');
    expect(issueCodes(report)).toContain('INTAKE_PDF_USED_OCR');
    expect(report.summary.warningCount).toBe(1);
    expect(issue?.severity).toBe('warning');
    expect(issue?.titleKey).toBe('exportReadiness.issues.intakeUsedOcr.title');
  });

  it('decreases score as issues accumulate', () => {
    const cleanReport = analyze();
    const noisyReport = analyze({
      resume: cloneResume({
        personal: { ...defaultResume.personal, fullName: '', email: '', phone: '', location: '' },
        summary: 'Short',
      }),
    });

    expect(noisyReport.score).toBeLessThan(cleanReport.score);
  });

  it('returns passes for completed checks', () => {
    const report = analyze();

    expect(report.passes.map(pass => pass.code)).toEqual(expect.arrayContaining([
      'CONTACT_INFO_COMPLETE',
      'SUMMARY_READY',
      'EXPERIENCE_PRESENT',
      'SKILLS_READY',
      'EXPORT_SOURCE_READY',
    ]));
    expect(report.summary.passCount).toBe(report.passes.length);
  });
});