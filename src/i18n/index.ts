import { create } from 'zustand';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type TranslationKey,
  type TranslationParams,
  type TranslationSchema,
} from './types';

export {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
} from './types';
export type {
  SupportedLocale,
  TranslationKey,
  TranslationParams,
  TranslationSchema,
} from './types';

export const LOCALE_STORAGE_KEY = 'resume-generator-locale';

const translations: Record<SupportedLocale, TranslationSchema> = {
  en,
  'zh-CN': zhCN,
};

type LocaleState = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage as Storage;
  }

  return null;
}

function normalizeLocaleCandidate(locale: string | null | undefined): SupportedLocale | null {
  if (!locale) {
    return null;
  }

  const normalized = locale.toLowerCase();

  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en';
  }

  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh-CN';
  }

  return SUPPORTED_LOCALES.includes(locale as SupportedLocale) ? (locale as SupportedLocale) : null;
}

function readStoredLocale(): SupportedLocale | null {
  try {
    return normalizeLocaleCandidate(getStorage()?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getNavigatorLocales(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }

  return [...(navigator.languages || []), navigator.language].filter(Boolean);
}

export function getBrowserLocale(): SupportedLocale {
  for (const locale of getNavigatorLocales()) {
    const normalized = normalizeLocaleCandidate(locale);
    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}

export function hasExplicitLocaleChoice(): boolean {
  return readStoredLocale() !== null;
}

export function getInitialLocale(): SupportedLocale {
  // Default to the explicit stored choice; otherwise stay on DEFAULT_LOCALE
  // instead of silently switching the UI based on the browser's locale.
  // Users opt into a non-default language via the in-app language switcher,
  // and `getBrowserLocale()` remains available for callers that want to
  // surface a one-time language suggestion.
  return readStoredLocale() || DEFAULT_LOCALE;
}

function persistLocale(locale: SupportedLocale): void {
  try {
    getStorage()?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage write failures.
  }
}

function updateDocumentLanguage(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

function resolveTranslationValue(locale: SupportedLocale, key: TranslationKey): string | undefined {
  const messageSet = translations[locale];
  const segments = key.split('.');
  let current: unknown = messageSet;

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/{{\s*(\w+)\s*}}/g, (match, paramName: string) => {
    const value = params[paramName];
    return value === undefined ? match : String(value);
  });
}

export function translate(locale: SupportedLocale, key: TranslationKey, params?: TranslationParams): string {
  const message = resolveTranslationValue(locale, key) || resolveTranslationValue(DEFAULT_LOCALE, key);

  if (!message) {
    return key;
  }

  return interpolate(message, params);
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: getInitialLocale(),
  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },
}));

useLocaleStore.subscribe((state, previousState) => {
  if (state.locale !== previousState.locale) {
    updateDocumentLanguage(state.locale);
  }
});

updateDocumentLanguage(useLocaleStore.getState().locale);

export function getCurrentLocale(): SupportedLocale {
  return useLocaleStore.getState().locale;
}
