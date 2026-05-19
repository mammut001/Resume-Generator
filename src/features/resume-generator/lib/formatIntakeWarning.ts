import type { TranslationKey, TranslationParams } from '@/i18n';
import type { ResumeIntakeWarning } from '@/types/resume';

type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

const fieldPathKeyMap: Record<string, TranslationKey> = {
  'personal.fullName': 'fields.fullName',
  'personal.email': 'fields.email',
  'personal.phone': 'fields.phone',
  'personal.location': 'fields.location',
  summary: 'sections.summary',
  experience: 'sections.experience',
  education: 'sections.education',
  skills: 'sections.skills',
  projects: 'sections.projects',
};

function translateFieldPath(fieldPath: string | undefined, t: TranslateFn): string {
  if (!fieldPath) {
    return t('common.source').toLowerCase();
  }

  return fieldPathKeyMap[fieldPath] ? t(fieldPathKeyMap[fieldPath]) : fieldPath;
}

export function formatIntakeWarningMessage(warning: ResumeIntakeWarning, t: TranslateFn): string {
  switch (warning.code) {
    case 'MISSING_NAME':
      return t('intake.warningMessages.missingName');
    case 'MISSING_EMAIL':
      return t('intake.warningMessages.missingEmail');
    case 'MISSING_PHONE':
      return t('intake.warningMessages.missingPhone');
    case 'MISSING_LOCATION':
      return t('intake.warningMessages.missingLocation');
    case 'MISSING_SUMMARY':
      return t('intake.warningMessages.missingSummary');
    case 'MISSING_EXPERIENCE':
      return t('intake.warningMessages.missingExperience');
    case 'MISSING_EDUCATION':
      return t('intake.warningMessages.missingEducation');
    case 'MISSING_SKILLS':
      return t('intake.warningMessages.missingSkills');
    case 'UNCERTAIN_DATES':
      return t('intake.warningMessages.uncertainDates');
    case 'LOW_CONFIDENCE_SECTION':
      return t('intake.warningMessages.lowConfidenceSection', { section: translateFieldPath(warning.fieldPath, t) });
    case 'MODEL_OUTPUT_REPAIRED':
      return t('intake.warningMessages.modelOutputRepaired');
    case 'MODEL_GATEWAY_FAILED':
      return t('intake.warningMessages.modelGatewayFailed');
    case 'MODEL_GATEWAY_NOT_CONFIGURED':
      return t('intake.warningMessages.modelGatewayNotConfigured');
    case 'PDF_LIKELY_PACKET':
      return t('intake.warningMessages.pdfLikelyPacket');
    case 'PDF_MULTIPLE_CANDIDATES':
      return t('intake.warningMessages.pdfMultipleCandidates');
    case 'PDF_REVIEW_REQUIRED':
      return t('intake.warningMessages.pdfReviewRequired');
    case 'PDF_USED_OCR':
      return t('intake.warningMessages.pdfUsedOcr');
    case 'PDF_OCR_LOW_CONFIDENCE':
      return t('intake.warningMessages.pdfOcrLowConfidence');
    default:
      return warning.message;
  }
}