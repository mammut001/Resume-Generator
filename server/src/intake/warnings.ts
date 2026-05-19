import { ResumeData, ResumeIntakeResult, ResumeIntakeWarning } from './types.js';

const stableCodes = new Set([
  'MISSING_NAME',
  'MISSING_EMAIL',
  'MISSING_PHONE',
  'MISSING_LOCATION',
  'MISSING_SUMMARY',
  'MISSING_EXPERIENCE',
  'MISSING_EDUCATION',
  'MISSING_SKILLS',
  'UNCERTAIN_DATES',
  'LOW_CONFIDENCE_SECTION',
  'MODEL_OUTPUT_REPAIRED',
  'MODEL_GATEWAY_FAILED',
  'MODEL_GATEWAY_NOT_CONFIGURED',
  'PDF_USED_OCR',
  'PDF_OCR_LOW_CONFIDENCE',
  'PDF_LIKELY_PACKET',
  'PDF_MULTIPLE_CANDIDATES',
  'PDF_REVIEW_REQUIRED',
]);

export function normalizeIntakeWarnings(warnings: Array<ResumeIntakeWarning | string | unknown>): ResumeIntakeWarning[] {
  const normalized = warnings.flatMap(normalizeWarning).filter((warning): warning is ResumeIntakeWarning => Boolean(warning));
  const seen = new Set<string>();

  return normalized.filter(warning => {
    const key = buildWarningDedupKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildWarningDedupKey(warning: ResumeIntakeWarning): string {
  if (warning.code.startsWith('MISSING_')) {
    return warning.code;
  }

  if (warning.code.startsWith('PDF_')) {
    return warning.code;
  }

  if (warning.code === 'UNCERTAIN_DATES') {
    return warning.code;
  }

  return `${warning.code}:${warning.fieldPath || ''}`;
}

export function reconcileWarningsWithResume(resume: ResumeData, warnings: ResumeIntakeWarning[]): ResumeIntakeWarning[] {
  return normalizeIntakeWarnings(warnings).filter(warning => !isResolvedByResume(resume, warning));
}

export function buildMissingFieldWarnings(resume: ResumeData, result?: ResumeIntakeResult): ResumeIntakeWarning[] {
  const warnings: ResumeIntakeWarning[] = [];
  const missingSections = new Set<string>();

  if (!resume.personal.fullName || resume.personal.fullName === 'Imported Candidate') {
    warnings.push({ code: 'MISSING_NAME', message: 'Full name missing.', fieldPath: 'personal.fullName' });
    missingSections.add('personal');
  }

  if (!resume.personal.email) {
    warnings.push({ code: 'MISSING_EMAIL', message: 'Email address missing.', fieldPath: 'personal.email' });
    missingSections.add('personal');
  }

  if (!resume.personal.phone) {
    warnings.push({ code: 'MISSING_PHONE', message: 'Phone number missing.', fieldPath: 'personal.phone' });
    missingSections.add('personal');
  }

  if (!resume.personal.location) {
    warnings.push({ code: 'MISSING_LOCATION', message: 'Location missing.', fieldPath: 'personal.location' });
    missingSections.add('personal');
  }

  if (!resume.summary.trim()) {
    warnings.push({ code: 'MISSING_SUMMARY', message: 'Summary missing.', fieldPath: 'summary' });
    missingSections.add('summary');
  }

  if (resume.experience.length === 0) {
    warnings.push({ code: 'MISSING_EXPERIENCE', message: 'No employer or role history detected.', fieldPath: 'experience' });
    missingSections.add('experience');
  }

  if (resume.education.length === 0) {
    warnings.push({ code: 'MISSING_EDUCATION', message: 'No education entry detected.', fieldPath: 'education' });
    missingSections.add('education');
  }

  if (resume.skills.length === 0) {
    warnings.push({ code: 'MISSING_SKILLS', message: 'No skills detected.', fieldPath: 'skills' });
    missingSections.add('skills');
  }

  if (result) {
    for (const [section, confidence] of Object.entries(result.confidence.sections)) {
      if (section !== 'projects' && !missingSections.has(section) && confidence < 0.35) {
        warnings.push({
          code: 'LOW_CONFIDENCE_SECTION',
          message: `Low confidence for ${section}.`,
          fieldPath: section,
        });
      }
    }
  }

  return warnings;
}

function normalizeWarning(warning: ResumeIntakeWarning | string | unknown): ResumeIntakeWarning[] {
  if (typeof warning === 'string') {
    return [normalizeWarningObject({ code: inferCode('', warning), message: warning })];
  }

  if (!warning || typeof warning !== 'object') return [];

  const raw = warning as Partial<ResumeIntakeWarning>;
  if (typeof raw.message !== 'string' || raw.message.trim().length === 0) return [];

  const inferredCode = inferCode(raw.code || '', `${raw.message} ${raw.fieldPath || ''}`);
  if (inferredCode === 'MISSING_EMAIL_AND_PHONE') {
    return [
      normalizeWarningObject({ code: 'MISSING_EMAIL', message: raw.message, fieldPath: 'personal.email' }),
      normalizeWarningObject({ code: 'MISSING_PHONE', message: raw.message, fieldPath: 'personal.phone' }),
    ];
  }

  return [normalizeWarningObject({ code: inferredCode, message: raw.message, fieldPath: raw.fieldPath })];
}

function normalizeWarningObject(warning: ResumeIntakeWarning): ResumeIntakeWarning {
  const code = stableCodes.has(warning.code) ? warning.code : inferCode(warning.code, warning.message);
  const fieldPath = warning.fieldPath || defaultFieldPath(code);
  return {
    code,
    message: productMessage(code, warning.message),
    ...(fieldPath ? { fieldPath: normalizeFieldPath(code, fieldPath) } : {}),
  };
}

function inferCode(rawCode: string, text: string): string {
  const value = `${rawCode} ${text}`.toLowerCase();

  if (value.includes('pdf_likely_packet') || value.includes('resume packet') || value.includes('multiple resumes')) return 'PDF_LIKELY_PACKET';
  if (value.includes('pdf_multiple_candidates') || value.includes('more than one person')) return 'PDF_MULTIPLE_CANDIDATES';
  if (value.includes('pdf_review_required') || value.includes('review the generated draft carefully')) return 'PDF_REVIEW_REQUIRED';
  if (value.includes('pdf_used_ocr')) return 'PDF_USED_OCR';
  if (value.includes('pdf_ocr_low_confidence')) return 'PDF_OCR_LOW_CONFIDENCE';
  if (value.includes('model_output_repaired')) return 'MODEL_OUTPUT_REPAIRED';
  if (value.includes('model_gateway_failed')) return 'MODEL_GATEWAY_FAILED';
  if (value.includes('model_gateway_not_configured')) return 'MODEL_GATEWAY_NOT_CONFIGURED';
  if (value.includes('date') || value.includes('timeline')) return 'UNCERTAIN_DATES';
  if (value.includes('low confidence') || value.includes('uncertain section')) return 'LOW_CONFIDENCE_SECTION';
  if (value.includes('contact') && !value.includes('location')) return 'MISSING_EMAIL_AND_PHONE';
  if (value.includes('email')) return 'MISSING_EMAIL';
  if (value.includes('phone') || value.includes('telephone')) return 'MISSING_PHONE';
  if (value.includes('location') || value.includes('city')) return 'MISSING_LOCATION';
  if (value.includes('name')) return 'MISSING_NAME';
  if (value.includes('summary')) return 'MISSING_SUMMARY';
  if (value.includes('experience') || value.includes('employer') || value.includes('company') || value.includes('role')) return 'MISSING_EXPERIENCE';
  if (value.includes('education') || value.includes('school') || value.includes('degree')) return 'MISSING_EDUCATION';
  if (value.includes('skill')) return 'MISSING_SKILLS';

  return stableCodes.has(rawCode) ? rawCode : 'LOW_CONFIDENCE_SECTION';
}

function productMessage(code: string, fallback: string): string {
  switch (code) {
    case 'MISSING_NAME':
      return 'Full name missing.';
    case 'MISSING_EMAIL':
      return 'Email address missing.';
    case 'MISSING_PHONE':
      return 'Phone number missing.';
    case 'MISSING_LOCATION':
      return 'Location missing.';
    case 'MISSING_SUMMARY':
      return 'Summary missing.';
    case 'MISSING_EXPERIENCE':
      return 'No employer or role history detected.';
    case 'MISSING_EDUCATION':
      return 'No education entry detected.';
    case 'MISSING_SKILLS':
      return 'No skills detected.';
    case 'MODEL_OUTPUT_REPAIRED':
      return 'Model output was repaired to match the resume schema before review.';
    case 'MODEL_GATEWAY_NOT_CONFIGURED':
      return 'This draft used the local intake parser because the model gateway is not configured.';
    case 'PDF_LIKELY_PACKET':
      return 'This PDF looks like multiple resumes or a resume packet. Choose a page or page range before generating a draft.';
    case 'PDF_MULTIPLE_CANDIDATES':
      return 'This PDF appears to contain names or contact details for more than one person.';
    case 'PDF_REVIEW_REQUIRED':
      return 'This PDF may include extra pages or ambiguous structure. Review the generated draft carefully before applying.';
    case 'PDF_USED_OCR':
      return 'This PDF was scanned or image-only, so OCR was used. Review names, dates, and bullet text carefully before applying.';
    default:
      return fallback;
  }
}

function normalizeFieldPath(code: string, fieldPath: string): string {
  if (code === 'MISSING_NAME') {
    return fieldPath === 'personal' || fieldPath === 'name' || fieldPath === 'fullName' ? 'personal.fullName' : fieldPath;
  }

  if (code === 'MISSING_EMAIL') {
    return fieldPath === 'personal' || fieldPath === 'email' ? 'personal.email' : fieldPath;
  }

  if (code === 'MISSING_PHONE') {
    return fieldPath === 'personal' || fieldPath === 'phone' ? 'personal.phone' : fieldPath;
  }

  if (code === 'MISSING_LOCATION') {
    return fieldPath === 'personal' || fieldPath === 'location' ? 'personal.location' : fieldPath;
  }

  return fieldPath;
}

function defaultFieldPath(code: string): string | undefined {
  switch (code) {
    case 'MISSING_NAME':
      return 'personal.fullName';
    case 'MISSING_EMAIL':
      return 'personal.email';
    case 'MISSING_PHONE':
      return 'personal.phone';
    case 'MISSING_LOCATION':
      return 'personal.location';
    case 'MISSING_SUMMARY':
      return 'summary';
    case 'MISSING_EXPERIENCE':
      return 'experience';
    case 'MISSING_EDUCATION':
      return 'education';
    case 'MISSING_SKILLS':
      return 'skills';
    default:
      return undefined;
  }
}

function isResolvedByResume(resume: ResumeData, warning: ResumeIntakeWarning): boolean {
  switch (warning.code) {
    case 'MISSING_NAME':
      return Boolean(resume.personal.fullName && resume.personal.fullName !== 'Imported Candidate');
    case 'MISSING_EMAIL':
      return Boolean(resume.personal.email);
    case 'MISSING_PHONE':
      return Boolean(resume.personal.phone);
    case 'MISSING_LOCATION':
      return Boolean(resume.personal.location);
    case 'MISSING_SUMMARY':
      return Boolean(resume.summary.trim());
    case 'MISSING_EXPERIENCE':
      return resume.experience.length > 0;
    case 'MISSING_EDUCATION':
      return resume.education.length > 0;
    case 'MISSING_SKILLS':
      return resume.skills.length > 0;
    default:
      return false;
  }
}