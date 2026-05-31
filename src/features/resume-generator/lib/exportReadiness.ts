import type { TranslationKey } from '@/i18n/types';
import type { ResumeData, ResumeIntakeWarning } from '@/types/resume';

export type ExportReadinessLevel = 'ready' | 'needs_review' | 'blocked';
export type ExportReadinessSeverity = 'pass' | 'suggestion' | 'warning' | 'blocker';
export type ExportReadinessSection = 'personal' | 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'design' | 'export';
export type RenderStatus = 'idle' | 'rendering' | 'success' | 'error';

export type ExportReadinessIssue = {
  id: string;
  code: string;
  severity: ExportReadinessSeverity;
  titleKey: TranslationKey;
  descriptionKey?: TranslationKey;
  section?: ExportReadinessSection;
  fieldPath?: string;
};

export type ExportReadinessReport = {
  level: ExportReadinessLevel;
  score: number;
  summary: {
    blockerCount: number;
    warningCount: number;
    suggestionCount: number;
    passCount: number;
  };
  issues: ExportReadinessIssue[];
  passes: ExportReadinessIssue[];
};

export type AnalyzeExportReadinessInput = {
  resume: ResumeData;
  typstSource: string;
  renderStatus: RenderStatus;
  renderError?: string | null;
  templateIds?: string[];
  svgHtml?: string | null;
  intakeWarnings?: ResumeIntakeWarning[];
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const linkedInPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-z0-9._%-]+\/?$/i;
const githubPattern = /^(https?:\/\/)?(www\.)?github\.com\/[a-z0-9._-]+\/?$/i;
const websitePattern = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}([/?#][^\s]*)?$/i;

function clean(value: string | undefined | null): string {
  return (value || '').trim();
}

function countSkills(resume: ResumeData): number {
  return resume.skills.reduce((total, group) => total + group.items.filter(item => clean(item).length > 0).length, 0);
}

function countBullets(resume: ResumeData): number {
  const experienceBullets = resume.experience.reduce((total, item) => total + item.bullets.length, 0);
  const projectBullets = resume.projects.reduce((total, item) => total + item.bullets.length, 0);
  return experienceBullets + projectBullets;
}

function normalizeWarningCode(code: string): string {
  return code
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getIntakeWarningTranslationKeys(code: string): Pick<ExportReadinessIssue, 'titleKey' | 'descriptionKey'> {
  const normalizedCode = normalizeWarningCode(code);
  if (normalizedCode === 'PDF_USED_OCR') {
    return {
      titleKey: 'exportReadiness.issues.intakeUsedOcr.title',
      descriptionKey: 'exportReadiness.issues.intakeUsedOcr.description',
    };
  }
  if (normalizedCode === 'PDF_OCR_LOW_CONFIDENCE') {
    return {
      titleKey: 'exportReadiness.issues.intakeLowOcrConfidence.title',
      descriptionKey: 'exportReadiness.issues.intakeLowOcrConfidence.description',
    };
  }
  if (normalizedCode === 'MODEL_GATEWAY_FAILED' || normalizedCode === 'MODEL_GATEWAY_NOT_CONFIGURED' || normalizedCode === 'MODEL_OUTPUT_REPAIRED') {
    return {
      titleKey: 'exportReadiness.issues.intakeModelFallback.title',
      descriptionKey: 'exportReadiness.issues.intakeModelFallback.description',
    };
  }
  return {
    titleKey: 'exportReadiness.issues.intakeWarning.title',
    descriptionKey: 'exportReadiness.issues.intakeWarning.description',
  };
}

export function analyzeExportReadiness(input: AnalyzeExportReadinessInput): ExportReadinessReport {
  const issues: ExportReadinessIssue[] = [];
  const passes: ExportReadinessIssue[] = [];

  const addIssue = (
    code: string,
    severity: Exclude<ExportReadinessSeverity, 'pass'>,
    titleKey: TranslationKey,
    options: { descriptionKey?: TranslationKey; section?: ExportReadinessSection; fieldPath?: string } = {},
  ) => {
    issues.push({
      id: `${code}:${options.fieldPath || options.section || issues.length}`,
      code,
      severity,
      titleKey,
      ...options,
    });
  };

  const addPass = (code: string, titleKey: TranslationKey, section?: ExportReadinessSection) => {
    passes.push({ id: `${code}:${section || passes.length}`, code, severity: 'pass', titleKey, section });
  };

  const personal = input.resume.personal;
  const fullName = clean(personal.fullName);
  const email = clean(personal.email);
  const phone = clean(personal.phone);
  const location = clean(personal.location);
  const headline = clean(personal.headline);
  const website = clean(personal.website);
  const linkedIn = clean(personal.linkedin);
  const github = clean(personal.github);

  if (!fullName) addIssue('MISSING_NAME', 'blocker', 'exportReadiness.issues.missingName.title', { descriptionKey: 'exportReadiness.issues.missingName.description', section: 'personal', fieldPath: 'personal.fullName' });
  if (!email) {
    addIssue('MISSING_EMAIL', 'blocker', 'exportReadiness.issues.missingEmail.title', { descriptionKey: 'exportReadiness.issues.missingEmail.description', section: 'personal', fieldPath: 'personal.email' });
  } else if (!emailPattern.test(email)) {
    addIssue('INVALID_EMAIL', 'blocker', 'exportReadiness.issues.invalidEmail.title', { descriptionKey: 'exportReadiness.issues.invalidEmail.description', section: 'personal', fieldPath: 'personal.email' });
  }
  if (!phone) addIssue('MISSING_PHONE', 'suggestion', 'exportReadiness.issues.missingPhone.title', { descriptionKey: 'exportReadiness.issues.missingPhone.description', section: 'personal', fieldPath: 'personal.phone' });
  if (!location) addIssue('MISSING_LOCATION', 'suggestion', 'exportReadiness.issues.missingLocation.title', { descriptionKey: 'exportReadiness.issues.missingLocation.description', section: 'personal', fieldPath: 'personal.location' });
  if (linkedIn && !linkedInPattern.test(linkedIn)) addIssue('LINKEDIN_URL_SUSPICIOUS', 'suggestion', 'exportReadiness.issues.linkedinSuspicious.title', { descriptionKey: 'exportReadiness.issues.linkedinSuspicious.description', section: 'personal', fieldPath: 'personal.linkedin' });
  if (github && !githubPattern.test(github)) addIssue('GITHUB_URL_SUSPICIOUS', 'suggestion', 'exportReadiness.issues.githubSuspicious.title', { descriptionKey: 'exportReadiness.issues.githubSuspicious.description', section: 'personal', fieldPath: 'personal.github' });
  if (website && !websitePattern.test(website)) addIssue('WEBSITE_URL_SUSPICIOUS', 'suggestion', 'exportReadiness.issues.websiteSuspicious.title', { descriptionKey: 'exportReadiness.issues.websiteSuspicious.description', section: 'personal', fieldPath: 'personal.website' });
  if (!headline || headline.length < 12) addIssue('HEADLINE_TOO_SHORT', 'suggestion', 'exportReadiness.issues.headlineTooShort.title', { descriptionKey: 'exportReadiness.issues.headlineTooShort.description', section: 'personal', fieldPath: 'personal.headline' });
  if (fullName && email && emailPattern.test(email)) addPass('CONTACT_INFO_COMPLETE', 'exportReadiness.passes.contactComplete', 'personal');

  const summary = clean(input.resume.summary);
  if (!summary) {
    addIssue('SUMMARY_MISSING', 'suggestion', 'exportReadiness.issues.summaryMissing.title', { descriptionKey: 'exportReadiness.issues.summaryMissing.description', section: 'summary', fieldPath: 'summary' });
  } else if (summary.length < 80) {
    addIssue('SUMMARY_TOO_SHORT', 'suggestion', 'exportReadiness.issues.summaryTooShort.title', { descriptionKey: 'exportReadiness.issues.summaryTooShort.description', section: 'summary', fieldPath: 'summary' });
  } else if (summary.length > 600) {
    addIssue('SUMMARY_TOO_LONG', 'warning', 'exportReadiness.issues.summaryTooLong.title', { descriptionKey: 'exportReadiness.issues.summaryTooLong.description', section: 'summary', fieldPath: 'summary' });
  } else {
    addPass('SUMMARY_READY', 'exportReadiness.passes.summaryReady', 'summary');
  }

  const totalSkillCount = countSkills(input.resume);
  const hasAnyBodyContent = input.resume.experience.length > 0 || input.resume.education.length > 0 || totalSkillCount > 0 || input.resume.projects.length > 0;
  if (!hasAnyBodyContent) {
    addIssue('NO_RESUME_BODY', 'blocker', 'exportReadiness.issues.noResumeBody.title', { descriptionKey: 'exportReadiness.issues.noResumeBody.description', section: 'export' });
  } else {
    addPass('HAS_RESUME_BODY', 'exportReadiness.passes.hasResumeBody', 'export');
  }

  if (input.resume.experience.length === 0) {
    addIssue('NO_EXPERIENCE', 'warning', 'exportReadiness.issues.noExperience.title', { descriptionKey: 'exportReadiness.issues.noExperience.description', section: 'experience', fieldPath: 'experience' });
  } else {
    addPass('EXPERIENCE_PRESENT', 'exportReadiness.passes.experiencePresent', 'experience');
  }
  input.resume.experience.forEach((item, index) => {
    const prefix = `experience.${index}`;
    if (!clean(item.company)) addIssue('EXPERIENCE_COMPANY_MISSING', 'warning', 'exportReadiness.issues.experienceCompanyMissing.title', { section: 'experience', fieldPath: `${prefix}.company` });
    if (!clean(item.role)) addIssue('EXPERIENCE_ROLE_MISSING', 'warning', 'exportReadiness.issues.experienceRoleMissing.title', { section: 'experience', fieldPath: `${prefix}.role` });
    if (!clean(item.startDate)) addIssue('EXPERIENCE_START_DATE_MISSING', 'warning', 'exportReadiness.issues.experienceStartMissing.title', { section: 'experience', fieldPath: `${prefix}.startDate` });
    if (!item.current && !clean(item.endDate)) addIssue('EXPERIENCE_END_DATE_MISSING', 'warning', 'exportReadiness.issues.experienceEndMissing.title', { section: 'experience', fieldPath: `${prefix}.endDate` });
    if (item.bullets.length === 0) addIssue('EXPERIENCE_BULLETS_MISSING', 'suggestion', 'exportReadiness.issues.experienceBulletsMissing.title', { section: 'experience', fieldPath: `${prefix}.bullets` });
    if (item.bullets.length > 6) addIssue('EXPERIENCE_TOO_MANY_BULLETS', 'suggestion', 'exportReadiness.issues.experienceTooManyBullets.title', { section: 'experience', fieldPath: `${prefix}.bullets` });
    item.bullets.forEach((bullet, bulletIndex) => {
      const bulletText = clean(bullet);
      const fieldPath = `${prefix}.bullets.${bulletIndex}`;
      if (!bulletText) addIssue('EXPERIENCE_BULLET_EMPTY', 'warning', 'exportReadiness.issues.experienceBulletEmpty.title', { section: 'experience', fieldPath });
      else if (bulletText.length < 25) addIssue('EXPERIENCE_BULLET_TOO_SHORT', 'suggestion', 'exportReadiness.issues.experienceBulletTooShort.title', { section: 'experience', fieldPath });
      else if (bulletText.length > 240) addIssue('EXPERIENCE_BULLET_TOO_LONG', 'warning', 'exportReadiness.issues.experienceBulletTooLong.title', { section: 'experience', fieldPath });
    });
  });

  if (input.resume.education.length === 0) {
    addIssue('NO_EDUCATION', 'suggestion', 'exportReadiness.issues.noEducation.title', { descriptionKey: 'exportReadiness.issues.noEducation.description', section: 'education', fieldPath: 'education' });
  } else {
    addPass('EDUCATION_PRESENT', 'exportReadiness.passes.educationPresent', 'education');
  }
  input.resume.education.forEach((item, index) => {
    if (!clean(item.school)) addIssue('EDUCATION_SCHOOL_MISSING', 'warning', 'exportReadiness.issues.educationSchoolMissing.title', { section: 'education', fieldPath: `education.${index}.school` });
    if (!clean(item.degree)) addIssue('EDUCATION_DEGREE_MISSING', 'warning', 'exportReadiness.issues.educationDegreeMissing.title', { section: 'education', fieldPath: `education.${index}.degree` });
  });

  if (input.resume.skills.length === 0 || totalSkillCount === 0) {
    addIssue('NO_SKILLS', hasAnyBodyContent ? 'warning' : 'blocker', 'exportReadiness.issues.noSkills.title', { descriptionKey: 'exportReadiness.issues.noSkills.description', section: 'skills', fieldPath: 'skills' });
  } else if (totalSkillCount < 5) {
    addIssue('SKILL_TOTAL_TOO_LOW', 'suggestion', 'exportReadiness.issues.skillTotalTooLow.title', { descriptionKey: 'exportReadiness.issues.skillTotalTooLow.description', section: 'skills', fieldPath: 'skills' });
  } else {
    addPass('SKILLS_READY', 'exportReadiness.passes.skillsReady', 'skills');
  }
  input.resume.skills.forEach((group, index) => {
    const prefix = `skills.${index}`;
    if (!clean(group.category)) addIssue('SKILL_CATEGORY_EMPTY', 'warning', 'exportReadiness.issues.skillCategoryEmpty.title', { section: 'skills', fieldPath: `${prefix}.category` });
    if (group.items.length === 0) addIssue('SKILL_CATEGORY_NO_ITEMS', 'warning', 'exportReadiness.issues.skillCategoryNoItems.title', { section: 'skills', fieldPath: `${prefix}.items` });
    group.items.forEach((item, itemIndex) => {
      if (!clean(item)) addIssue('SKILL_ITEM_EMPTY', 'warning', 'exportReadiness.issues.skillItemEmpty.title', { section: 'skills', fieldPath: `${prefix}.items.${itemIndex}` });
    });
  });

  input.resume.projects.forEach((project, index) => {
    const prefix = `projects.${index}`;
    if (!clean(project.description)) addIssue('PROJECT_DESCRIPTION_MISSING', 'suggestion', 'exportReadiness.issues.projectDescriptionMissing.title', { section: 'projects', fieldPath: `${prefix}.description` });
    if (clean(project.url) && !websitePattern.test(clean(project.url))) addIssue('PROJECT_URL_SUSPICIOUS', 'suggestion', 'exportReadiness.issues.projectUrlSuspicious.title', { section: 'projects', fieldPath: `${prefix}.url` });
    project.bullets.forEach((bullet, bulletIndex) => {
      const bulletText = clean(bullet);
      const fieldPath = `${prefix}.bullets.${bulletIndex}`;
      if (!bulletText) addIssue('PROJECT_BULLET_EMPTY', 'warning', 'exportReadiness.issues.projectBulletEmpty.title', { section: 'projects', fieldPath });
      else if (bulletText.length > 240) addIssue('PROJECT_BULLET_TOO_LONG', 'suggestion', 'exportReadiness.issues.projectBulletTooLong.title', { section: 'projects', fieldPath });
    });
  });

  if (input.renderStatus === 'error') {
    addIssue('RENDER_ERROR', 'blocker', 'exportReadiness.issues.renderError.title', { descriptionKey: 'exportReadiness.issues.renderError.description', section: 'export', fieldPath: input.renderError ? 'renderError' : undefined });
  } else if (input.renderStatus === 'rendering') {
    addIssue('RENDERING_IN_PROGRESS', 'warning', 'exportReadiness.issues.rendering.title', { descriptionKey: 'exportReadiness.issues.rendering.description', section: 'export' });
  }

  if (!clean(input.typstSource)) {
    addIssue('TYPST_SOURCE_EMPTY', 'blocker', 'exportReadiness.issues.typstSourceEmpty.title', { descriptionKey: 'exportReadiness.issues.typstSourceEmpty.description', section: 'export', fieldPath: 'typstSource' });
  } else if (input.renderStatus !== 'error') {
    addPass('EXPORT_SOURCE_READY', 'exportReadiness.passes.exportSourceReady', 'export');
  }
  if (input.renderStatus === 'success' && input.svgHtml !== undefined && !clean(input.svgHtml)) {
    addIssue('PREVIEW_EMPTY', 'warning', 'exportReadiness.issues.previewEmpty.title', { descriptionKey: 'exportReadiness.issues.previewEmpty.description', section: 'export' });
  }
  if (input.templateIds?.length) {
    if (!input.templateIds.includes(input.resume.templateId)) {
      addIssue('TEMPLATE_MISSING', 'blocker', 'exportReadiness.issues.templateMissing.title', { descriptionKey: 'exportReadiness.issues.templateMissing.description', section: 'design', fieldPath: 'templateId' });
    } else {
      addPass('TEMPLATE_READY', 'exportReadiness.passes.templateReady', 'design');
    }
  }

  const bulletCount = countBullets(input.resume);
  if (bulletCount > 18 || input.resume.projects.length > 4 || (summary.length > 500 && bulletCount > 14)) {
    addIssue('RESUME_MAY_EXCEED_ONE_PAGE', 'suggestion', 'exportReadiness.issues.mayExceedOnePage.title', { descriptionKey: 'exportReadiness.issues.mayExceedOnePage.description', section: 'design' });
  }

  input.intakeWarnings?.forEach((warning, index) => {
    const normalizedCode = normalizeWarningCode(warning.code || `WARNING_${index}`);
    const translationKeys = getIntakeWarningTranslationKeys(normalizedCode);
    addIssue(`INTAKE_${normalizedCode}`, 'warning', translationKeys.titleKey, {
      descriptionKey: translationKeys.descriptionKey,
      section: 'export',
      fieldPath: warning.fieldPath,
    });
  });

  const blockerCount = issues.filter(issue => issue.severity === 'blocker').length;
  const warningCount = issues.filter(issue => issue.severity === 'warning').length;
  const suggestionCount = issues.filter(issue => issue.severity === 'suggestion').length;
  const level: ExportReadinessLevel = blockerCount > 0 ? 'blocked' : warningCount + suggestionCount > 0 ? 'needs_review' : 'ready';
  const score = Math.max(0, 100 - blockerCount * 25 - warningCount * 10 - suggestionCount * 4);

  return {
    level,
    score,
    summary: { blockerCount, warningCount, suggestionCount, passCount: passes.length },
    issues,
    passes,
  };
}

export function getExportReadiness(resume: ResumeData): ExportReadinessReport {
  return analyzeExportReadiness({ resume, typstSource: 'generated', renderStatus: 'idle' });
}