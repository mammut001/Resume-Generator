import type { TranslationKey, TranslationParams } from '@/i18n';

type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;

const UNKNOWN_ERROR_FALLBACK = 'Unknown error';

// Errors thrown from library code (e.g. resumeIntake, exportResume) so the
// UI layer can translate them instead of leaking hardcoded English to the
// user when the interface language is Chinese.
export class TranslationError extends Error {
  readonly key: TranslationKey;
  readonly params?: TranslationParams;

  constructor(key: TranslationKey, params?: TranslationParams) {
    super(key);
    this.name = 'TranslationError';
    this.key = key;
    this.params = params;
  }
}

function unknown(t?: TranslateFn): string {
  return t ? t('errors.unknown') : UNKNOWN_ERROR_FALLBACK;
}

export function formatError(error: unknown, t?: TranslateFn): string {
  if (error === null) return unknown(t);
  if (error === undefined) return unknown(t);
  if (error instanceof TranslationError) return t ? t(error.key, error.params) : error.key;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return unknown(t);
  }
}
