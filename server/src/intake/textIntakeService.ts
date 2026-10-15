import { ResumeData, ResumeIntakeResult, ResumeIntakeWarning } from './types.js';
import { validateResumeIntakeResult } from './resumeSchema.js';
import { buildResumeDraftWithModel, hasModelGatewayConfig, ModelGatewayConfig, ModelGatewayError } from './modelGateway.js';
import { sanitizeIntakeResume, websiteIsInSource } from './resumeFidelity.js';
import { parseStructuredResume } from './structuredResume.js';
import { buildMissingFieldWarnings, normalizeIntakeWarnings, reconcileWarningsWithResume } from './warnings.js';

const defaultDesign: ResumeData['design'] = {
  typography: 'classic',
  density: 'comfortable',
  pageSize: 'letter',
  accentColor: '#2563eb',
};

const knownSkills = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Vue',
  'Tailwind',
  'Tailwind CSS',
  'Figma',
  'Node',
  'Python',
  'GraphQL',
  'Jest',
  'Playwright',
  'Design Systems',
  'Accessibility',
];

const roleKeywords = [
  'frontend engineer',
  'software engineer',
  'product designer',
  'product manager',
  'data analyst',
  'backend engineer',
  'full stack engineer',
];

type IntakeSourceKind = ResumeIntakeResult['source']['kind'];

export async function buildResumeDraftFromParagraph(
  input: string,
  modelGatewayConfig: ModelGatewayConfig = {},
): Promise<ResumeIntakeResult> {
  return buildResumeDraftFromSourceText(input, 'paragraph', modelGatewayConfig);
}

export async function buildResumeDraftFromPdfText(
  input: string,
  modelGatewayConfig: ModelGatewayConfig = {},
): Promise<ResumeIntakeResult> {
  return buildResumeDraftFromSourceText(input, 'pdf', modelGatewayConfig);
}

async function buildResumeDraftFromSourceText(
  input: string,
  sourceKind: IntakeSourceKind,
  modelGatewayConfig: ModelGatewayConfig = {},
): Promise<ResumeIntakeResult> {
  const text = normalizeSourceText(input);
  const structured = tryStructuredResume(text);
  if (structured) {
    return buildStructuredResumeDraft(text, sourceKind, structured, hasModelGatewayConfig(modelGatewayConfig) ? null : {
      code: 'MODEL_GATEWAY_NOT_CONFIGURED',
      message: 'This draft used the local intake parser. Configure a model gateway before presenting it as AI-generated output.',
    });
  }

  if (hasModelGatewayConfig(modelGatewayConfig)) {
    try {
      const modelResult = await buildResumeDraftWithModel(text, modelGatewayConfig);
      const resume = withChinesePageSize(sanitizeIntakeResume(modelResult.resume, text), text);
      return validateResumeIntakeResult({
        ...modelResult,
        resume,
        warnings: reconcileWarningsWithResume(resume, [
          ...modelResult.warnings,
          ...buildMissingFieldWarnings(resume, { ...modelResult, resume }),
        ]),
        source: {
          kind: sourceKind,
          extractedText: text,
        },
      });
    } catch (error) {
      return buildLocalResumeDraft(text, sourceKind, buildGatewayFailureWarning(error));
    }
  }

  return buildLocalResumeDraft(text, sourceKind, {
    code: 'MODEL_GATEWAY_NOT_CONFIGURED',
    message: 'This draft used the local intake parser. Configure a model gateway before presenting it as AI-generated output.',
  });
}

function tryStructuredResume(text: string): ResumeData | null {
  try {
    return parseStructuredResume(text);
  } catch {
    return null;
  }
}

function buildStructuredResumeDraft(
  text: string,
  sourceKind: IntakeSourceKind,
  resume: ResumeData,
  modelWarning: ResumeIntakeWarning | null,
): ResumeIntakeResult {
  const warnings: ResumeIntakeWarning[] = [];
  if (modelWarning) warnings.push(modelWarning);

  const undated = resume.experience.filter(entry => !entry.startDate && !entry.endDate).map(entry => entry.company);
  if (undated.length > 0) {
    warnings.push({
      code: 'UNCERTAIN_DATES',
      message: `Dates were not clearly detected for ${undated.join(', ')}.`,
      fieldPath: 'experience',
    });
  }

  const sections = {
    personal: resume.personal.fullName === 'Imported Candidate' ? 0.45 : 0.92,
    summary: resume.summary ? 0.9 : 0.2,
    experience: resume.experience.length > 0 ? 0.93 : 0.2,
    education: resume.education.length > 0 ? 0.9 : 0.25,
    skills: resume.skills.length > 0 ? 0.9 : 0.25,
    projects: resume.projects.length > 0 ? 0.9 : 0.4,
  };

  try {
    const result = validateResumeIntakeResult({
      resume,
      confidence: {
        overall: roundConfidence(Object.values(sections).reduce((sum, value) => sum + value, 0) / Object.values(sections).length),
        sections,
      },
      warnings: normalizeIntakeWarnings(warnings),
      source: {
        kind: sourceKind,
        extractedText: text,
      },
    });

    return validateResumeIntakeResult({
      ...result,
      warnings: reconcileWarningsWithResume(result.resume, [
        ...result.warnings,
        ...buildMissingFieldWarnings(result.resume, result),
      ]),
    });
  } catch {
    return buildProseResumeDraft(normalizeWhitespace(text), sourceKind, modelWarning || {
      code: 'MODEL_GATEWAY_NOT_CONFIGURED',
      message: 'This draft used the local intake parser. Configure a model gateway before presenting it as AI-generated output.',
    });
  }
}

function buildLocalResumeDraft(text: string, sourceKind: IntakeSourceKind, modelWarning: ResumeIntakeWarning): ResumeIntakeResult {
  const structured = tryStructuredResume(text);
  if (structured) return buildStructuredResumeDraft(text, sourceKind, structured, modelWarning);

  const collapsed = normalizeWhitespace(text);
  return buildProseResumeDraft(collapsed, sourceKind, modelWarning);
}

function buildProseResumeDraft(text: string, sourceKind: IntakeSourceKind, modelWarning: ResumeIntakeWarning): ResumeIntakeResult {
  const warnings: ResumeIntakeWarning[] = [];
  const headline = detectHeadline(text);
  const personal = detectPersonal(text, headline, warnings);
  const experience = detectExperience(text, headline, warnings);
  const education = detectEducation(text, warnings);
  const skills = detectSkills(text, warnings);
  const summary = buildSummary(text, headline, experience, skills);

  if (!personal.email) {
    warnings.push({ code: 'MISSING_EMAIL', message: 'No email address was detected.', fieldPath: 'personal.email' });
  }

  if (!personal.phone) {
    warnings.push({ code: 'MISSING_PHONE', message: 'No phone number was detected.', fieldPath: 'personal.phone' });
  }

  const resume: ResumeData = {
    id: `intake-${Date.now()}`,
    title: `${headline} Resume`,
    templateId: 'clean-professional',
    design: {
      ...defaultDesign,
      pageSize: /[\u4e00-\u9fff]/.test(text) ? 'a4' : 'letter',
    },
    personal,
    summary,
    experience,
    education,
    skills,
    projects: [],
  };

  const sections = {
    personal: personal.fullName === 'Imported Candidate' ? 0.45 : 0.72,
    summary: summary ? 0.76 : 0.2,
    experience: experience.length > 0 ? 0.74 : 0.2,
    education: education.length > 0 ? 0.68 : 0.25,
    skills: skills.length > 0 ? 0.78 : 0.25,
    projects: 0.25,
  };

  const result = validateResumeIntakeResult({
    resume,
    confidence: {
      overall: roundConfidence(Object.values(sections).reduce((sum, value) => sum + value, 0) / Object.values(sections).length),
      sections,
    },
    warnings: normalizeIntakeWarnings([
      modelWarning,
      ...warnings,
    ]),
    source: {
      kind: sourceKind,
      extractedText: text,
    },
  });

  return validateResumeIntakeResult({
    ...result,
    warnings: reconcileWarningsWithResume(result.resume, [
      ...result.warnings,
      ...buildMissingFieldWarnings(result.resume, result),
    ]),
  });
}

function detectPersonal(text: string, headline: string, warnings: ResumeIntakeWarning[]): ResumeData['personal'] {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || '';
  const linkedin = text.match(/linkedin\.com\/[^\s,;.)]+/i)?.[0];
  const github = text.match(/github\.com\/[^\s,;.)]+/i)?.[0];
  const website = detectWebsite(text, email);
  const name = detectName(text);

  if (name === 'Imported Candidate') {
    warnings.push({ code: 'MISSING_NAME', message: 'No confident full name was detected.', fieldPath: 'personal.fullName' });
  }

  return {
    fullName: name,
    headline,
    email,
    phone,
    location: '',
    ...(website ? { website } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
  };
}

function detectName(text: string): string {
  const namedPrefix = text.match(/(?:[Mm]y name is|[Ii] am|[Ii]['’]m)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (namedPrefix?.[1]) return namedPrefix[1];

  const firstLine = text.split(/[.\n]/)[0]?.trim() || '';
  const leadingName = firstLine.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+)(?:,|\s+-\s+)/);
  return leadingName?.[1] || 'Imported Candidate';
}

function detectHeadline(text: string): string {
  const lowerText = text.toLowerCase();
  const role = roleKeywords.find(keyword => lowerText.includes(keyword));
  if (!role && /\b(frontend|front-end|react|typescript|web apps?)\b/i.test(text)) {
    return 'Frontend Engineer';
  }

  if (!role) return 'Resume Candidate';

  return role
    .split(' ')
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

function detectExperience(text: string, headline: string, warnings: ResumeIntakeWarning[]): ResumeData['experience'] {
  const entries: ResumeData['experience'] = [];
  const explicitCompanyPattern = /(?:worked at|at)\s+([A-Z][A-Za-z0-9& .-]+?)\s+from\s+([A-Za-z]{3,9}\s+)?(\d{4})(?:\s+(?:until|to|through|-)\s+(now|present|[A-Za-z]{3,9}\s+\d{4}|\d{4}))?/gi;

  for (const match of text.matchAll(explicitCompanyPattern)) {
    const company = cleanCompany(match[1]);
    if (!company || entries.some(entry => entry.company.toLowerCase() === company.toLowerCase())) continue;

    const endDate = match[4] || '';
    entries.push({
      id: `exp-${entries.length + 1}`,
      company,
      role: headline,
      startDate: `${match[2] || ''}${match[3]}`.trim(),
      endDate: /^(now|present)$/i.test(endDate) ? '' : endDate,
      current: /^(now|present)$/i.test(endDate),
      bullets: extractBulletsNearCompany(text, company),
    });
  }

  const beforeThatPattern = /before that\s+(?:i\s+)?(?:was|worked)\s+at\s+([A-Z][A-Za-z0-9& .-]+?)(?:\s+doing|\s+building|\s+on|[,.])/i;
  const beforeThatCompany = beforeThatPattern.exec(text)?.[1];
  if (beforeThatCompany) {
    const company = cleanCompany(beforeThatCompany);
    if (company && !entries.some(entry => entry.company.toLowerCase() === company.toLowerCase())) {
      entries.push({
        id: `exp-${entries.length + 1}`,
        company,
        role: headline,
        startDate: '',
        endDate: '',
        current: false,
        bullets: extractBulletsNearCompany(text, company),
      });
      warnings.push({ code: 'UNCERTAIN_DATES', message: `Dates were not clearly detected for ${company}.`, fieldPath: `experience.${entries.length - 1}` });
    }
  }

  detectRoleAtExperience(text, entries, headline, warnings);
  detectChineseExperience(text, entries, headline, warnings);

  if (entries.length === 0) {
    warnings.push({ code: 'MISSING_EXPERIENCE', message: 'No experience entries were confidently detected.', fieldPath: 'experience' });
  }

  return entries;
}

const proseRole = '(?:(?:Senior|Junior|Associate|Staff|Lead|Principal)\\s+)?(?:(?:Frontend|Backend|Full[- ]Stack|Software|Product|Data|Business|Machine Learning|ML)\\s+)?(?:Engineer|Designer|Manager|Analyst|Developer|Scientist|Intern|Researcher|Consultant)';

function detectRoleAtExperience(text: string, entries: ResumeData['experience'], headline: string, warnings: ResumeIntakeWarning[]) {
  const pattern = new RegExp(`\\b(${proseRole})\\s+at\\s+([A-Z][A-Za-z0-9&.'’.-]+(?:\\s+[A-Z][A-Za-z0-9&.'’.-]+){0,5})`, 'g');
  for (const match of text.matchAll(pattern)) {
    const role = cleanPhrase(match[1]);
    const company = cleanCompany(match[2]);
    if (!company || entries.some(entry => entry.company.toLowerCase() === company.toLowerCase())) continue;
    const window = text.slice(match.index || 0, (match.index || 0) + match[0].length + 80);
    const dates = datesNear(window);
    entries.push({
      id: `exp-${entries.length + 1}`,
      company,
      role: role || headline,
      startDate: dates.startDate,
      endDate: dates.endDate,
      current: dates.current,
      bullets: sentenceAround(text, company),
    });
    if (!dates.startDate && !dates.endDate) {
      warnings.push({ code: 'UNCERTAIN_DATES', message: `Dates were not clearly detected for ${company}.`, fieldPath: `experience.${entries.length - 1}` });
    }
  }
}

function detectChineseExperience(text: string, entries: ResumeData['experience'], headline: string, warnings: ResumeIntakeWarning[]) {
  const patterns = [
    /在([^，。；\n]{2,24}?)(?:担任|任职|工作)(?:过)?([^，。；\n]{2,16})/g,
    /担任([^，。；\n]{2,16})[，,]?(?:就职于|任职于)([^，。；\n]{2,24})/g,
    /就职于([^，。；\n]{2,24})/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const companyFirst = pattern.source.startsWith('在') || pattern.source.startsWith('就职于');
      const company = cleanPhrase(companyFirst ? match[1] : match[2]);
      const role = cleanPhrase(companyFirst ? (match[2] || headline) : match[1]);
      if (!company || entries.some(entry => entry.company === company)) continue;
      const windowStart = Math.max(0, (match.index || 0) - 20);
      const dates = datesNear(text.slice(windowStart, (match.index || 0) + match[0].length + 40));
      entries.push({
        id: `exp-${entries.length + 1}`,
        company,
        role: role || headline,
        startDate: dates.startDate,
        endDate: dates.endDate,
        current: dates.current,
        bullets: sentenceAround(text, company),
      });
      if (!dates.startDate && !dates.endDate) {
        warnings.push({ code: 'UNCERTAIN_DATES', message: `Dates were not clearly detected for ${company}.`, fieldPath: `experience.${entries.length - 1}` });
      }
    }
  }
}

function datesNear(text: string): { startDate: string; endDate: string; current: boolean } {
  const ranged = text.match(/(?:from|since)\s+((?:[A-Za-z]{3,9}\.?\s+)?\d{4})(?:\s+(?:to|until|through|-|–|—)\s+((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|present|now))?/i);
  if (ranged) {
    const current = !ranged[2] || /^(present|now)$/i.test(ranged[2]);
    return {
      startDate: ranged[1].trim(),
      endDate: current ? '' : ranged[2].trim(),
      current: Boolean(current && /since|present|now/i.test(text)),
    };
  }

  const chinese = text.match(/(\d{4}\s*年(?:\s*\d{1,2}\s*月)?)(?:\s*(?:至|到|-|–|—)\s*(\d{4}\s*年(?:\s*\d{1,2}\s*月)?|至今))?/);
  if (chinese) {
    const ongoing = chinese[2] === '至今' || !chinese[2];
    return {
      startDate: chinese[1].trim(),
      endDate: ongoing ? '' : (chinese[2] || '').trim(),
      current: chinese[2] === '至今' || (!chinese[2] && /至今|目前/.test(text)),
    };
  }

  return { startDate: '', endDate: '', current: false };
}

function sentenceAround(text: string, company: string): string[] {
  const clauses = extractBulletsNearCompany(text, company);
  if (clauses.length > 0) return clauses;
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sentence = text.match(new RegExp(`[^。\\n.]*${escaped}[^。\\n.]*[。.]?`))?.[0]?.trim();
  if (!sentence || sentence.length < 12 || sentence.length > 240) return [];
  return [sentence.replace(/\s+/g, ' ')];
}

function cleanPhrase(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[，,。.\s]+$/g, '').trim();
}

function detectEducation(text: string, warnings: ResumeIntakeWarning[]): ResumeData['education'] {
  const entries: ResumeData['education'] = [];
  const studied = text.match(/studied\s+([A-Za-z .&]+?)\s+at\s+([A-Z][A-Za-z .,&-]+?)(?:[,.]|$)/i);
  if (studied) {
    entries.push({
      id: 'edu-1',
      school: studied[2].trim(),
      degree: 'Degree',
      field: normalizeField(studied[1]),
    });
  }

  const degreeFrom = text.matchAll(/(?:^|[^A-Za-z])((?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?B\.?A\.?|Ph\.?D\.?|Bachelor(?: of [A-Za-z ]+)?|Master(?: of [A-Za-z ]+)?|MBA))(?![A-Za-z])(?:\s+in\s+([A-Za-z ]{2,40}?))?\s+from\s+(?:the\s+)?([A-Z][A-Za-z0-9&.,'’ -]{2,80}?)(?=[,.]|$)/gi);
  for (const match of degreeFrom) {
    const school = match[3].trim();
    if (entries.some(entry => entry.school.toLowerCase() === school.toLowerCase())) continue;
    entries.push({
      id: `edu-${entries.length + 1}`,
      school,
      degree: match[1].trim(),
      ...(match[2] ? { field: normalizeField(match[2]) } : {}),
    });
  }

  const graduated = text.match(/毕业于\s*([^，。\n]{2,30})/);
  if (graduated && !entries.some(entry => entry.school === graduated[1].trim())) {
    entries.push({
      id: `edu-${entries.length + 1}`,
      school: graduated[1].trim(),
      degree: '学位',
    });
  }

  if (entries.length === 0) {
    warnings.push({ code: 'MISSING_EDUCATION', message: 'No education entry was confidently detected.', fieldPath: 'education' });
  }

  return entries;
}

function detectSkills(text: string, warnings: ResumeIntakeWarning[]): ResumeData['skills'] {
  const lowerText = text.toLowerCase();
  const detected = knownSkills.filter(skill => lowerText.includes(skill.toLowerCase()));
  const listed = text.match(/(?:skills?\s+include|tools?\s+include|proficient in|familiar with|擅长|熟悉|技能(?:包括)?[:：])\s*([^.]{2,240})/i);
  if (listed?.[1]) {
    detected.push(...listed[1].split(/\s*(?:,\s*(?:and|及|与|和)\b|，|、|,|\band\b|及|与|和)\s*/i).map(item => item.trim()).filter(item => item.length > 1 && item.length <= 40));
  }

  const items = Array.from(new Set(detected));
  if (items.length === 0) {
    warnings.push({ code: 'MISSING_SKILLS', message: 'No recognizable skills were detected.', fieldPath: 'skills' });
    return [];
  }

  return [
    {
      id: 'skill-1',
      category: /[\u4e00-\u9fff]/.test(text) ? '技能' : 'Skills',
      items,
    },
  ];
}

function detectWebsite(text: string, email: string): string | undefined {
  const withoutEmails = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  const withoutProfiles = withoutEmails
    .replace(/linkedin\.com\/[^\s,;.)]+/gi, ' ')
    .replace(/github\.com\/[^\s,;.)]+/gi, ' ');
  const match = withoutProfiles.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:dev|com|io|me|design)(?:\/[^\s,;.)]*)?/i)?.[0];
  if (!match) return undefined;
  const normalized = match.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!websiteIsInSource(normalized, text)) return undefined;
  if (email && normalized.toLowerCase() === email.split('@')[1]?.toLowerCase()) return undefined;
  return normalized;
}

function buildSummary(text: string, headline: string, experience: ResumeData['experience'], skills: ResumeData['skills']): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const withoutIntro = cleaned.replace(/^(?:my name is|i am|i['’]m|我叫|我是)\s+[^.,，。]{2,40}[,，]\s*/i, '');
  const sentences = withoutIntro.split(/(?<=[.。])\s+/).slice(0, 2).join(' ').trim();
  if (sentences.length >= 40) return sentences.slice(0, 500);

  const skillText = skills[0]?.items.slice(0, 5).join(', ');
  const companyText = experience.map(entry => entry.company).filter(Boolean).slice(0, 2).join(' and ');
  if (companyText && skillText) {
    return `${headline} with experience at ${companyText}, working across ${skillText}. Drafted from source material and ready for review.`;
  }

  return `${headline} with background described in the provided source material. Review this draft for missing details and specificity.`;
}

function withChinesePageSize(resume: ResumeData, sourceText: string): ResumeData {
  if (!/[\u4e00-\u9fff]/.test(sourceText) || resume.design.pageSize === 'a4') return resume;
  return { ...resume, design: { ...resume.design, pageSize: 'a4' } };
}

function extractBulletsNearCompany(text: string, company: string): string[] {
  const escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nearbySentence = text.match(new RegExp(`[^.]*${escapedCompany}[^.]*\.?(?:\s+[^.]*\.)?`, 'i'))?.[0] || text;
  const clauses = nearbySentence
    .split(/,|;|\band\b/i)
    .map(clause => clause.trim())
    .filter(clause => /\b(built|led|mentored|developed|implemented|created|shipped|owned|designed|improved)\b/i.test(clause));

  return clauses.slice(0, 3).map(clause => sentenceCase(clause.replace(/^i\s+/i, '')));
}

function cleanCompany(company: string): string {
  return company.replace(/\b(from|doing|building|until|to|now|present)\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

function normalizeField(field: string): string {
  const trimmed = field.trim();
  if (/^cs$/i.test(trimmed)) return 'Computer Science';
  return sentenceCase(trimmed);
}

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.]+$/, '');
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}.` : trimmed;
}

function normalizeSourceText(value: string): string {
  return value
    .replaceAll('\u0000', ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildGatewayFailureWarning(error: unknown): ResumeIntakeWarning {
  if (error instanceof ModelGatewayError) {
    const repairSuffix = error.repairAttempted ? ' after one schema repair attempt' : '';

    if (error.reason === 'timeout') {
      return {
        code: 'MODEL_GATEWAY_FAILED',
        message: `The model gateway timed out${repairSuffix}, so this draft used the local intake parser instead.`,
      };
    }

    if (error.reason === 'malformed_json') {
      return {
        code: 'MODEL_GATEWAY_FAILED',
        message: `The model returned malformed JSON${repairSuffix}, so this draft used the local intake parser instead.`,
      };
    }

    if (error.reason === 'schema_invalid') {
      return {
        code: 'MODEL_GATEWAY_FAILED',
        message: `The model output did not match the resume schema${repairSuffix}, so this draft used the local intake parser instead.`,
      };
    }
  }

  return {
    code: 'MODEL_GATEWAY_FAILED',
    message: 'The model gateway was unavailable, so this draft used the local intake parser instead.',
  };
}
