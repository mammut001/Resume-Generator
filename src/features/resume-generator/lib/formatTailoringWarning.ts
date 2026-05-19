import type { TranslationKey, TranslationParams } from '@/i18n';
import type { ResumeTailoringWarning } from '@/types/resume';

type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

export function formatTailoringWarningMessage(warning: ResumeTailoringWarning, t: TranslateFn): string {
  switch (warning.code) {
    case 'TAILORING_GAP':
      return t('tailoring.warningMessages.gap', { requirement: warning.requirement || warning.message });
    case 'TAILORING_LOW_CONFIDENCE':
      return t('tailoring.warningMessages.lowConfidence');
    case 'TAILORING_NO_JOB_DESCRIPTION':
      return t('tailoring.warningMessages.noJobDescription');
    case 'TAILORING_MODEL_GATEWAY_FAILED':
      return t('tailoring.warningMessages.modelGatewayFailed');
    case 'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED':
      return t('tailoring.warningMessages.modelGatewayNotConfigured');
    case 'TAILORING_OUTPUT_REPAIRED':
      return t('tailoring.warningMessages.outputRepaired');
    case 'TAILORING_UNSUPPORTED_FACT_REMOVED':
      return t('tailoring.warningMessages.unsupportedFactRemoved');
    default:
      return warning.message;
  }
}