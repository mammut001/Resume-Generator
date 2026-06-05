import { beforeEach, describe, expect, it, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

// In environments where `window` exists separately from `globalThis`
// (e.g. jsdom under Vitest), the i18n module's getStorage() may read from
// `window.localStorage` first. Mirror the mock onto `window` so that the
// module and the test agree on which storage to clear between cases.
if (typeof window !== 'undefined' && window !== globalThis) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
}

function mockNavigatorLanguage(language: string, languages: string[] = [language]) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      language,
      languages,
    },
  });
}

describe('i18n', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorageMock.clear();
    mockNavigatorLanguage('en-US');
  });

  it('prefers localStorage when resolving the initial locale', async () => {
    localStorageMock.setItem('resume-generator-locale', 'zh-CN');
    const { getInitialLocale } = await import('@/i18n');

    expect(getInitialLocale()).toBe('zh-CN');
  });

  it('does not auto-pick browser locales for the initial locale', async () => {
    mockNavigatorLanguage('zh-Hans-CN', ['zh-Hans-CN', 'en-US']);
    const { getInitialLocale } = await import('@/i18n');

    expect(getInitialLocale()).toBe('en');
  });

  it('falls back to en for unsupported browser locales', async () => {
    mockNavigatorLanguage('fr-FR', ['fr-FR']);
    const { getInitialLocale } = await import('@/i18n');

    expect(getInitialLocale()).toBe('en');
  });

  it('reads nested translation keys', async () => {
    const { translate } = await import('@/i18n');

    expect(translate('en', 'tabs.start')).toBe('Start');
    expect(translate('zh-CN', 'sections.experience')).toBe('工作经历');
  });

  it('interpolates translation params', async () => {
    const { translate } = await import('@/i18n');

    expect(
      translate('en', 'intake.notices.uploading', { fileName: 'resume.pdf' }),
    ).toBe('Uploading resume.pdf...');
  });

  it('returns the key when a translation is missing', async () => {
    const { translate } = await import('@/i18n');

    expect(translate('en', 'toast.draftApplied')).toBe('Draft applied');
    expect(translate('en', 'common.ready')).toBe('Ready');
  });

  it('updates locale state and persists the selection', async () => {
    const { LOCALE_STORAGE_KEY, useLocaleStore } = await import('@/i18n');

    useLocaleStore.getState().setLocale('zh-CN');

    expect(useLocaleStore.getState().locale).toBe('zh-CN');
    expect(localStorageMock.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });

  it('exposes getBrowserLocale separately for UI suggestions', async () => {
    mockNavigatorLanguage('zh-Hans-CN', ['zh-Hans-CN', 'en-US']);
    const { getBrowserLocale } = await import('@/i18n');

    expect(getBrowserLocale()).toBe('zh-CN');
  });

  it('hasExplicitLocaleChoice reflects storage state', async () => {
    const { hasExplicitLocaleChoice } = await import('@/i18n');

    expect(hasExplicitLocaleChoice()).toBe(false);

    localStorageMock.setItem('resume-generator-locale', 'zh-CN');
    expect(hasExplicitLocaleChoice()).toBe(true);
  });
});
