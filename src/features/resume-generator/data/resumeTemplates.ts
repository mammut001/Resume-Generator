import { translate, type SupportedLocale, type TranslationKey } from '@/i18n';
import { ResumeData } from '@/types/resume';
import { resumeDesignDefaults } from './resumeDesign';

export type ResumeTemplate = {
  id: string;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  preview: {
    layoutLabelKey: TranslationKey;
    tagKeys: readonly [TranslationKey, TranslationKey];
    imagePath: string;
  };
  render: (resume: ResumeData, locale: SupportedLocale) => string;
};

const TEMPLATE_PREVIEW_VERSION = '20260519-1';

function templatePreviewPath(fileName: string): string {
  return `/template-previews/${fileName}?v=${TEMPLATE_PREVIEW_VERSION}`;
}

const templateAliases: Record<string, string> = {
  'clean-professional': 'basic-resume',
  'modern-compact': 'rendercv',
};

const LATIN_FONT_FALLBACK = 'New Computer Modern';
const ZH_TYPST_LANG = 'zh';

export const resumeTemplates: ResumeTemplate[] = [
  {
    id: 'basic-resume',
    nameKey: 'templates.basicResume.name',
    descriptionKey: 'templates.basicResume.description',
    preview: {
      layoutLabelKey: 'templates.basicResume.layoutLabel',
      tagKeys: ['templates.basicResume.tags.primary', 'templates.basicResume.tags.secondary'],
      imagePath: templatePreviewPath('basic-resume.svg'),
    },
    render: basicResumeTemplate,
  },
  {
    id: 'brilliant-cv',
    nameKey: 'templates.brilliantCv.name',
    descriptionKey: 'templates.brilliantCv.description',
    preview: {
      layoutLabelKey: 'templates.brilliantCv.layoutLabel',
      tagKeys: ['templates.brilliantCv.tags.primary', 'templates.brilliantCv.tags.secondary'],
      imagePath: templatePreviewPath('brilliant-cv.svg'),
    },
    render: brilliantCvTemplate,
  },
  {
    id: 'rendercv',
    nameKey: 'templates.rendercv.name',
    descriptionKey: 'templates.rendercv.description',
    preview: {
      layoutLabelKey: 'templates.rendercv.layoutLabel',
      tagKeys: ['templates.rendercv.tags.primary', 'templates.rendercv.tags.secondary'],
      imagePath: templatePreviewPath('rendercv.svg'),
    },
    render: renderCvTemplate,
  },
];

export function resolveTemplateId(templateId: string): string {
  return templateAliases[templateId] || templateId;
}

function escapeTypstString(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function escapeTypstMarkup(text: string): string {
  return text
    .replace(/[\\*_`$#@<>[\]~/%]/g, char => `\\${char}`)
    .replace(/(^|\n)([=+*-])/g, (_match, lead: string, char: string) => `${lead}\\${char}`);
}

function escapeTypst(text: string): string {
  return escapeTypstMarkup(text);
}

function typstString(text: string): string {
  return `"${escapeTypstString(text)}"`;
}

function typstRawString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function typstContent(text: string): string {
  return `[${escapeTypstMarkup(text)}]`;
}

function linkTarget(value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function typstOptionalLink(label: string): string {
  const target = linkTarget(label);
  const visible = escapeTypstMarkup(label);
  if (!target) return visible;
  return `#link(${typstString(target)})[${visible}]`;
}

function typstBulletList(items: string[]): string {
  const lines = items.map(item => item.trim()).filter(Boolean);
  if (lines.length === 0) return '""';
  return `list(\n${lines.map(line => `    [${escapeTypstMarkup(line)}],`).join('\n')}\n  )`;
}

function typstEmphasized(text: string): string {
  return `*${escapeTypstMarkup(text)}*`;
}

function formatDate(date: string): string {
  return date || '';
}

function dateRange(start?: string, end?: string, current?: boolean, locale: SupportedLocale = 'en'): string {
  if (!start && !end) return '';
  if (current) return `${formatDate(start || '')} – ${translate(locale, 'document.present')}`;
  return [formatDate(start || ''), formatDate(end || '')].filter(Boolean).join(' – ');
}

function normalizeHexColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : resumeDesignDefaults.accentColor;
}

function isChineseLocale(locale: SupportedLocale): boolean {
  return locale === 'zh-CN';
}

function typstLocalePrelude(locale: SupportedLocale): string {
  if (!isChineseLocale(locale)) {
    return '';
  }

  return `#set text(lang: ${typstString(ZH_TYPST_LANG)})\n\n`;
}

function pagePaper(resume: ResumeData): string {
  return resume.design?.pageSize === 'a4' ? 'a4' : 'us-letter';
}

function skillSeparator(locale: SupportedLocale): string {
  return isChineseLocale(locale) ? '、' : ', ';
}

function sameSectionLabel(category: string, sectionTitle: string): boolean {
  return category.trim().toLowerCase() === sectionTitle.trim().toLowerCase();
}

function renderLabeledSkills(resume: ResumeData, locale: SupportedLocale): string {
  const sectionTitle = translate(locale, 'document.skills');
  const separator = skillSeparator(locale);
  return resume.skills.map(skill => {
    const items = escapeTypst(skill.items.join(separator));
    if (sameSectionLabel(skill.category, sectionTitle)) return items;
    return `*${escapeTypst(skill.category)}:* ${items}`;
  }).join('\n');
}

function compactLines(lines: Array<string | undefined | null>): string[] {
  return lines.filter((line): line is string => Boolean(line && line.trim()));
}

function firstLastName(fullName: string, locale: SupportedLocale = 'en'): { firstName: string; lastName: string; displayName?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) || '' };
  }
  const fallback = translate(locale, 'document.untitledName');
  return { firstName: fullName || fallback, lastName: '', displayName: fullName || fallback };
}

function resumeKeywords(resume: ResumeData): string[] {
  return Array.from(new Set(resume.skills.flatMap(skill => skill.items).filter(Boolean))).slice(0, 12);
}

function basicResumeTemplate(resume: ResumeData, locale: SupportedLocale): string {
  const accentColor = normalizeHexColor(resume.design?.accentColor || resumeDesignDefaults.accentColor);
  const sections = compactLines([
    resume.summary ? `== ${escapeTypst(translate(locale, 'document.summary'))}\n${escapeTypst(resume.summary)}` : '',
    renderBasicExperience(resume, locale),
    renderBasicEducation(resume, locale),
    renderBasicSkills(resume, locale),
    renderBasicProjects(resume, locale),
  ]).join('\n\n');

  return `#import "@preview/basic-resume:0.2.9": *

${typstLocalePrelude(locale)}

#show: resume.with(
  author: ${typstString(resume.personal.fullName)},
  location: ${typstString(resume.personal.location)},
  email: ${typstString(resume.personal.email)},
  github: ${typstString(resume.personal.github || '')},
  linkedin: ${typstString(resume.personal.linkedin || '')},
  phone: ${typstString(resume.personal.phone)},
  personal-site: ${typstString(resume.personal.website || '')},
  accent-color: ${typstRawString(accentColor)},
  paper: ${typstString(pagePaper(resume))},
  author-position: left,
  personal-info-position: left,
)

${renderBasicHeadline(resume)}
${renderBasicExtraLink(resume)}
${sections}
`;
}

function renderBasicHeadline(resume: ResumeData): string {
  const headline = resume.personal.headline.trim();
  if (!headline) return '';
  return `#text(style: "italic")[${escapeTypst(headline)}]\n`;
}

function renderBasicExtraLink(resume: ResumeData): string {
  const extraLink = resume.personal.extraLink?.trim();
  if (!extraLink) return '';
  return `${typstOptionalLink(extraLink)}\n`;
}

function renderBasicExperience(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.experience.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.experience'))}\n\n${resume.experience.map(exp => {
    const bullets = exp.bullets.filter(Boolean).map(bullet => `- ${escapeTypst(bullet)}`).join('\n');
    return `#work(\n  title: ${typstString(exp.role)},\n  location: ${typstString(exp.location || '')},\n  company: ${typstString(exp.company)},\n  dates: ${typstString(dateRange(exp.startDate, exp.endDate, exp.current, locale))},\n)\n${bullets}`;
  }).join('\n\n')}`;
}

function renderBasicEducation(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.education.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.education'))}\n\n${resume.education.map(edu => {
    const degree = `${edu.degree}${edu.field ? `${translate(locale, 'document.educationDegreeConnector')}${edu.field}` : ''}`;
    const details = detailLines(edu.details);
    return `#edu(\n  institution: ${typstString(edu.school)},\n  location: ${typstString(edu.location || '')},\n  dates: ${typstString(dateRange(edu.startDate, edu.endDate, false, locale))},\n  degree: ${typstString(degree)},\n)${details}`;
  }).join('\n\n')}`;
}

function renderBasicSkills(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.skills.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.skills'))}\n\n${renderLabeledSkills(resume, locale)}`;
}

function renderBasicProjects(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.projects.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.projects'))}\n\n${resume.projects.map(project => {
    const bullets = projectNarrativeLines(project).map(line => `- ${escapeTypst(line)}`).join('\n');
    return `#project(\n  name: ${typstString(project.name)},\n  role: "",\n  url: ${typstString(project.url || '')},\n)\n${bullets}`;
  }).join('\n\n')}`;
}

function renderCvConnection(value: string): string {
  const target = linkTarget(value);
  if (!target) return escapeTypstMarkup(value);
  return `#link(${typstString(target)}, ${typstString(value)})`;
}

function renderCvTemplate(resume: ResumeData, locale: SupportedLocale): string {
  const accentColor = normalizeHexColor(resume.design?.accentColor || resumeDesignDefaults.accentColor);
  const connections = compactLines([
    resume.personal.location,
    resume.personal.email ? `#link(${typstString(`mailto:${resume.personal.email}`)}, ${typstString(resume.personal.email)})` : '',
    resume.personal.phone,
    resume.personal.linkedin ? `#link(${typstString(`https://${resume.personal.linkedin}`)}, ${typstString(resume.personal.linkedin)})` : '',
    resume.personal.github ? `#link(${typstString(`https://${resume.personal.github}`)}, ${typstString(resume.personal.github)})` : '',
    resume.personal.website ? `#link(${typstString(`https://${resume.personal.website}`)}, ${typstString(resume.personal.website)})` : '',
    resume.personal.extraLink ? renderCvConnection(resume.personal.extraLink) : '',
  ]).map(item => `[${item}]`).join(',\n  ');

  return `#import "@preview/rendercv:0.3.0": *

${typstLocalePrelude(locale)}

#show: rendercv.with(
  name: ${typstString(resume.personal.fullName)},
  page-size: ${typstString(resume.design?.pageSize === 'a4' ? 'a4' : 'us-letter')},
  colors-name: rgb(${typstRawString(accentColor)}),
  colors-section-titles: rgb(${typstRawString(accentColor)}),
  typography-font-family-body: ${typstString(LATIN_FONT_FALLBACK)},
  typography-font-family-name: ${typstString(LATIN_FONT_FALLBACK)},
  typography-font-family-section-titles: ${typstString(LATIN_FONT_FALLBACK)},
  typography-font-family-headline: ${typstString(LATIN_FONT_FALLBACK)},
  typography-font-family-connections: ${typstString(LATIN_FONT_FALLBACK)},
)

= ${escapeTypst(resume.personal.fullName)}

#headline(${typstContent(resume.personal.headline)})

#connections(
  ${connections}
)

${resume.summary ? `== ${escapeTypst(translate(locale, 'document.summary'))}\n\n#summary(${typstContent(resume.summary)})\n` : ''}
${renderRenderCvExperience(resume, locale)}

${renderRenderCvEducation(resume, locale)}

${renderRenderCvSkills(resume, locale)}

${renderRenderCvProjects(resume, locale)}
`;
}

function renderRenderCvExperience(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.experience.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.experience'))}\n\n${resume.experience.map(exp => `#regular-entry(\n  [${typstEmphasized(exp.role)}, ${escapeTypstMarkup(exp.company)}${exp.location ? ` -- ${escapeTypstMarkup(exp.location)}` : ''}],\n  ${typstContent(dateRange(exp.startDate, exp.endDate, exp.current, locale))},\n  main-column-second-row: [\n${exp.bullets.filter(Boolean).map(bullet => `    - ${escapeTypstMarkup(bullet)}`).join('\n')}\n  ],\n)`).join('\n\n')}`;
}

function renderRenderCvEducation(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.education.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.education'))}\n\n${resume.education.map(edu => {
    const degree = `${edu.degree}${edu.field ? `${translate(locale, 'document.educationDegreeConnector')}${edu.field}` : ''}`;
    const details = detailLines(edu.details, '    ');
    return `#education-entry(\n  [${typstEmphasized(edu.school)}, ${escapeTypstMarkup(degree)}${edu.location ? ` -- ${escapeTypstMarkup(edu.location)}` : ''}],\n  ${typstContent(dateRange(edu.startDate, edu.endDate, false, locale))},\n)${details}`;
  }).join('\n\n')}`;
}

function renderRenderCvSkills(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.skills.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.skills'))}\n\n${renderLabeledSkills(resume, locale)}`;
}

function renderRenderCvProjects(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.projects.length) return '';
  return `== ${escapeTypst(translate(locale, 'document.projects'))}\n\n${resume.projects.map(project => `#regular-entry(\n  [${typstEmphasized(project.name)}${project.url ? ` -- ${escapeTypstMarkup(project.url)}` : ''}],\n  [],\n  main-column-second-row: [\n${projectNarrativeLines(project).map(line => `    - ${escapeTypstMarkup(line)}`).join('\n')}\n  ],\n)`).join('\n\n')}`;
}

function brilliantCvTemplate(resume: ResumeData, locale: SupportedLocale): string {
  const accentColor = normalizeHexColor(resume.design?.accentColor || resumeDesignDefaults.accentColor);
  const { firstName, lastName, displayName } = firstLastName(resume.personal.fullName, locale);
  const keywords = resumeKeywords(resume).map(typstString).join(', ');
  const personalInfo = compactLines([
    resume.personal.email ? `email: ${typstString(resume.personal.email)}` : '',
    resume.personal.phone ? `phone: ${typstString(resume.personal.phone)}` : '',
    resume.personal.linkedin ? `linkedin: ${typstString(resume.personal.linkedin.replace(/^linkedin\.com\/in\//, ''))}` : '',
    resume.personal.github ? `github: ${typstString(resume.personal.github.replace(/^github\.com\//, ''))}` : '',
    resume.personal.website ? `homepage: ${typstString(resume.personal.website.replace(/^https?:\/\//, ''))}` : '',
    resume.personal.location ? `location: ${typstString(resume.personal.location)}` : '',
  ]).join(',\n      ');

  return `#import "@preview/brilliant-cv:4.0.1": cv, cv-section, cv-entry, cv-skill

${typstLocalePrelude(locale)}

#let metadata = (
  header_quote: ${typstString(resume.personal.headline)},
  cv_footer: ${typstString(resume.title)},
  layout: (
    awesome_color: ${typstRawString(accentColor)},
    before_section_skip: "2pt",
    before_entry_skip: "2pt",
    before_entry_description_skip: "1pt",
    paper_size: ${typstString(resume.design?.pageSize === 'a4' ? 'a4' : 'us-letter')},
    date_width: "3.8cm",
    fonts: (
      regular_fonts: (${typstString(LATIN_FONT_FALLBACK)},),
      header_font: ${typstString(LATIN_FONT_FALLBACK)},
    ),
    header: (
      header_align: "left",
      display_profile_photo: false,
      profile_photo_radius: "50%",
      info_font_size: "9pt",
    ),
    entry: (
      display_entry_society_first: false,
      display_logo: false,
    ),
    section: (
      title_highlight: "first-letters",
      title_highlight_letters: 3,
    ),
    footer: (
      display_page_counter: false,
      display_footer: false,
    ),
  ),
  inject: (
    injected_keywords_list: (${keywords}${keywords ? ',' : ''}),
  ),
  personal: (
    first_name: ${typstString(firstName)},
    last_name: ${typstString(lastName)},
    ${displayName ? `display_name: ${typstString(displayName)},` : ''}
    info: (
      ${personalInfo}
    ),
  ),
)

#show: cv.with(metadata, profile-photo: none)

${resume.personal.extraLink ? `${typstOptionalLink(resume.personal.extraLink)}\n` : ''}
${resume.summary ? `#cv-section(${typstString(translate(locale, 'document.summary'))})\n${escapeTypstMarkup(resume.summary)}\n` : ''}
${renderBrilliantExperience(resume, locale)}

${renderBrilliantEducation(resume, locale)}

${renderBrilliantSkills(resume, locale)}

${renderBrilliantProjects(resume, locale)}
`;
}

function renderBrilliantExperience(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.experience.length) return '';
  return `#cv-section(${typstString(translate(locale, 'document.experience'))})
${resume.experience.map(exp => {
    return `#cv-entry(
  title: ${typstString(exp.role)},
  society: ${typstString(exp.company)},
  date: ${typstString(dateRange(exp.startDate, exp.endDate, exp.current, locale))},
  location: ${typstString(exp.location || '')},
  description: ${typstBulletList(exp.bullets)},
)`;
  }).join('\n\n')}`;
}

function renderBrilliantEducation(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.education.length) return '';
  return `#cv-section(${typstString(translate(locale, 'document.education'))})\n${resume.education.map(edu => {
    const degree = `${edu.degree}${edu.field ? `${translate(locale, 'document.educationDegreeConnector')}${edu.field}` : ''}`;
    const details = (edu.details || []).filter(Boolean);
    return `#cv-entry(\n  title: ${typstString(degree)},\n  society: ${typstString(edu.school)},\n  date: ${typstString(dateRange(edu.startDate, edu.endDate, false, locale))},\n  location: ${typstString(edu.location || '')},\n  ${details.length ? `description: ${typstBulletList(details)},\n  ` : ''})`;
  }).join('\n\n')}`;
}

function renderBrilliantSkills(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.skills.length) return '';
  const sectionTitle = translate(locale, 'document.skills');
  const separator = skillSeparator(locale);
  return `#cv-section(${typstString(sectionTitle)})\n${resume.skills.map(skill => {
    const category = sameSectionLabel(skill.category, sectionTitle) ? '' : skill.category;
    return `#cv-skill(type: ${typstString(category)}, info: ${typstString(skill.items.join(separator))})`;
  }).join('\n')}`;
}

function renderBrilliantProjects(resume: ResumeData, locale: SupportedLocale): string {
  if (!resume.projects.length) return '';
  return `#cv-section(${typstString(translate(locale, 'document.projects'))})
${resume.projects.map(project => {
    return `#cv-entry(
  title: ${typstString(project.name)},
  society: ${typstString(project.url || '')},
  date: "",
  location: "",
  description: ${typstBulletList(projectNarrativeLines(project))},
)`;
  }).join('\n\n')}`;
}

function detailLines(details: string[] | undefined, indent = ''): string {
  const lines = (details || []).map(detail => detail.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  return `\n${lines.map(detail => `${indent}- ${escapeTypst(detail)}`).join('\n')}`;
}

function projectNarrativeLines(project: { description?: string; bullets: string[] }): string[] {
  const bullets = dedupeNarrative(project.bullets.map(collapseRepeatedNarrative));
  const description = collapseRepeatedNarrative(project.description || '');
  const lines = description && !bullets.some(bullet => sameNarrative(bullet, description))
    ? [description, ...bullets]
    : bullets;
  return dedupeNarrative(lines);
}

function collapseRepeatedNarrative(value: string): string {
  const compact = value.trim().replace(/\s+/g, ' ');
  if (compact.length < 16) return value.trim();
  const midpoint = Math.floor(compact.length / 2);
  for (let split = midpoint - 8; split <= midpoint + 8; split += 1) {
    if (split < 8 || split >= compact.length - 8) continue;
    const left = compact.slice(0, split).trim();
    const right = compact.slice(split).trim();
    if (left.length >= 8 && left === right) return left;
  }
  return value.trim();
}

function dedupeNarrative(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter(line => {
    const key = line.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameNarrative(left: string, right: string): boolean {
  const key = left.trim().replace(/\s+/g, ' ').toLowerCase();
  return key.length > 0 && key === right.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function renderResumeToTypst(resume: ResumeData, templateId: string, locale: SupportedLocale = 'en'): string {
  const resolvedTemplateId = resolveTemplateId(templateId);
  const template = resumeTemplates.find(t => t.id === resolvedTemplateId) || resumeTemplates[0];
  return template.render(resume, locale);
}

export function getTemplateById(id: string): ResumeTemplate | undefined {
  const resolvedTemplateId = resolveTemplateId(id);
  return resumeTemplates.find(t => t.id === resolvedTemplateId);
}
