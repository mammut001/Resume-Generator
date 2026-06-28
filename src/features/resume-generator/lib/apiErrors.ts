import type { TranslationKey } from '@/i18n';
import { TranslationError } from './formatError';

const API_ERROR_KEYS: Record<string, TranslationKey> = {
  QUOTA_EXCEEDED: 'errors.quotaExceeded',
  PAYLOAD_TOO_LARGE: 'errors.payloadTooLarge',
  VALIDATION_ERROR: 'errors.validationFailed',
  TAILORING_NO_JOB_DESCRIPTION: 'errors.tailoringNoJobDescription',
};

export async function throwApiError(response: Response, fallbackKey: TranslationKey): Promise<never> {
  const payload = await response.json().catch(() => null);
  const code = payload?.error?.code;

  if (typeof code === 'string' && API_ERROR_KEYS[code]) {
    throw new TranslationError(API_ERROR_KEYS[code]);
  }

  throw new TranslationError(fallbackKey);
}