import type { SupportedLocale } from '@/i18n';

export function toBcp47Locale(locale: SupportedLocale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function formatLocaleDateTime(value: string, locale: SupportedLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(toBcp47Locale(locale), { dateStyle: 'medium', timeStyle: 'short' });
}