import { useCallback } from 'react';
import { translate, useLocaleStore } from './index';
import type { TranslationKey, TranslationParams } from './types';

export function useI18n() {
  const locale = useLocaleStore(state => state.locale);
  const setLocale = useLocaleStore(state => state.setLocale);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  );

  return {
    locale,
    setLocale,
    t,
  };
}