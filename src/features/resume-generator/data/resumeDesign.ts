import type { TranslationKey } from '@/i18n';
import { ResumeDesignSettings } from '@/types/resume';

export const resumeDesignDefaults: ResumeDesignSettings = {
  typography: 'classic',
  density: 'comfortable',
  pageSize: 'letter',
  accentColor: '#2563eb',
};

type DesignOption<TValue extends string> = {
  id: TValue;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
};

export const typographyOptions: DesignOption<ResumeDesignSettings['typography']>[] = [
  { id: 'classic', labelKey: 'design.typography.classic.label', descriptionKey: 'design.typography.classic.description' },
  { id: 'sans', labelKey: 'design.typography.sans.label', descriptionKey: 'design.typography.sans.description' },
  { id: 'mono', labelKey: 'design.typography.mono.label', descriptionKey: 'design.typography.mono.description' },
];

export const densityOptions: DesignOption<ResumeDesignSettings['density']>[] = [
  { id: 'compact', labelKey: 'design.density.compact.label', descriptionKey: 'design.density.compact.description' },
  { id: 'comfortable', labelKey: 'design.density.comfortable.label', descriptionKey: 'design.density.comfortable.description' },
  { id: 'spacious', labelKey: 'design.density.spacious.label', descriptionKey: 'design.density.spacious.description' },
];

export const pageSizeOptions: DesignOption<ResumeDesignSettings['pageSize']>[] = [
  { id: 'letter', labelKey: 'design.pageSize.letter.label', descriptionKey: 'design.pageSize.letter.description' },
  { id: 'a4', labelKey: 'design.pageSize.a4.label', descriptionKey: 'design.pageSize.a4.description' },
];

export const accentPaletteOptions: Array<{ nameKey: TranslationKey; value: string }> = [
  { nameKey: 'design.accent.signalBlue', value: '#2563eb' },
  { nameKey: 'design.accent.teal', value: '#0f766e' },
  { nameKey: 'design.accent.forest', value: '#15803d' },
  { nameKey: 'design.accent.amber', value: '#b45309' },
  { nameKey: 'design.accent.rose', value: '#be123c' },
  { nameKey: 'design.accent.graphite', value: '#334155' },
];