type TranslateFn = (key: 'errors.unknown') => string;

const UNKNOWN_ERROR_FALLBACK = 'Unknown error';

function unknown(t?: TranslateFn): string {
  return t ? t('errors.unknown') : UNKNOWN_ERROR_FALLBACK;
}

export function formatError(error: unknown, t?: TranslateFn): string {
  if (error === null) return unknown(t);
  if (error === undefined) return unknown(t);
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return unknown(t);
  }
}
