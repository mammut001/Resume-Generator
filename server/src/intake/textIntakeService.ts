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
    projects: detectProjects(text),
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
  const extraLink = detectSocialHandle(text);
  const name = detectName(text);

  if (name === 'Imported Candidate') {
    warnings.push({ code: 'MISSING_NAME', message: 'No confident full name was detected.', fieldPath: 'personal.fullName' });
  }

  return {
    fullName: name,
    headline,
    email,
    phone,
    location: detectLocation(text),
    ...(website ? { website } : {}),
    ...(extraLink ? { extraLink } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
  };
}

const nameToken = "[A-Z][A-Za-z'’._-]*";

function detectName(text: string): string {
  const namedPrefix = text.match(new RegExp(`(?:[Mm]y name is|[Ii] am|[Ii]['’]m)\\s+(${nameToken}(?:\\s+${nameToken})+)`));
  if (namedPrefix?.[1]) return namedPrefix[1];

  const firstLine = text.split(/[.\n]/)[0]?.trim() || '';
  const leadingName = firstLine.match(new RegExp(`^(${nameToken}(?:\\s+${nameToken}){1,2})(?:,|\\s+-\\s+|\\s+is\\b)`));
  return leadingName?.[1] || 'Imported Candidate';
}

function detectHeadline(text: string): string {
  const titled = text.match(new RegExp(`^${nameToken}(?:\\s+${nameToken}){1,2},\\s+([A-Z][A-Za-z0-9+./]*(?:\\s+[A-Z][A-Za-z0-9+./]*){0,5})(?=\\s+in\\s+[A-Z]|[,.]|$)`));
  if (titled?.[1] && looksLikeRoleTitle(titled[1])) return titled[1];

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

function looksLikeRoleTitle(value: string): boolean {
  return /\b(engineer|designer|manager|analyst|developer|scientist|advocate|intern|researcher|consultant|lead)\b/i.test(value);
}

function detectLocation(text: string): string {
  const match = text.match(/\b(?:based|located|living|residing)?\s*\bin\s+([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2},\s*[A-Z]{2})\b/);
  return match?.[1]?.replace(/\s+/g, ' ') || '';
}

function detectSocialHandle(text: string): string | undefined {
  const match = text.match(/(?:^|\s)(@[A-Za-z0-9._]+)(?:\s+on\s+([A-Za-z][A-Za-z0-9]*))?(?=\s|[.,]|$)/);
  if (!match) return undefined;
  return match[2] ? `${match[1]} on ${match[2]}` : match[1];
}

function detectExperience(text: string, headline: string, warnings: ResumeIntakeWarning[]): ResumeData['experience'] {
  const entries: ResumeData['experience'] = [];
  const explicitCompanyPattern = /(?:worked at|at)\s+([A-Z][A-Za-z0-9& .-]+?)\s+from\s+([A-Za-z]{3,9}\s+)?(\d{4})(?:\s+(?:until|to|through|-)\s+(now|present|[A-Za-z]{3,9}\s+\d{4}|\d{4}))?/gi;

  for (const match of text.matchAll(explicitCompanyPattern)) {
    const asParts = match[1].match(/^(.*?)\s+as\s+(?:an?\s+)?(.+)$/i);
    const company = cleanCompany(asParts?.[1] || match[1]);
    if (!company || entries.some(entry => entry.company.toLowerCase() === company.toLowerCase())) continue;

    const endDate = match[4] || '';
    entries.push({
      id: `exp-${entries.length + 1}`,
      company,
      role: tidyLabel(asParts?.[2] || '') || headline,
      startDate: `${match[2] || ''}${match[3]}`.trim(),
      endDate: /^(now|present)$/i.test(endDate) ? '' : endDate,
      current: /^(now|present)$/i.test(endDate),
      bullets: sentenceAround(text, company),
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
        bullets: sentenceAround(text, company),
      });
      warnings.push({ code: 'UNCERTAIN_DATES', message: `Dates were not clearly detected for ${company}.`, fieldPath: `experience.${entries.length - 1}` });
    }
  }

  detectRoleAtExperience(text, entries, headline, warnings);
  detectLooseEmployment(text, entries, headline, warnings);
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

function detectLooseEmployment(text: string, entries: ResumeData['experience'], headline: string, warnings: ResumeIntakeWarning[]) {
  const companyWord = '(?!since\\b|from\\b|in\\b|during\\b|as\\b|until\\b|and\\b|with\\b|the\\b|a\\b|an\\b)[A-Za-z][A-Za-z0-9&.\'’\\-]*';
  const pattern = new RegExp(`\\b(?:(?:worked|interned|served)\\s+(?:at|for)|joined)\\s+(${companyWord}(?:\\s+${companyWord}){0,4})`, 'gi');
  for (const match of text.matchAll(pattern)) {
    const company = presentCompany(cleanCompany(match[1]));
    if (!company || entries.some(entry => entry.company.toLowerCase() === company.toLowerCase())) continue;
    const window = text.slice(match.index || 0, (match.index || 0) + match[0].length + 120);
    const dates = datesNear(window);
    const roleMatch = window.match(/\bas\s+(?:an?\s+)?([A-Za-z][A-Za-z0-9 /'+.-]{1,48}?)(?=\s+(?:from|since|in|during|until)\b|[,.]|$)/i);
    entries.push({
      id: `exp-${entries.length + 1}`,
      company,
      role: tidyLabel(roleMatch?.[1] || '') || headline,
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
  const paren = text.match(/\((\d{4})\s*[-–—]\s*(\d{4}|present|now)\)/i);
  if (paren) {
    const current = /^(present|now)$/i.test(paren[2]);
    return { startDate: paren[1], endDate: current ? '' : paren[2], current };
  }

  const ranged = text.match(/(?:from|since|in|during)\s+((?:[A-Za-z]{3,9}\.?\s+)?\d{4})(?:\s+(?:to|until|through|-|–|—)\s+((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|present|now))?/i);
  if (ranged) {
    const current = !ranged[2] || /^(present|now)$/i.test(ranged[2]);
    return {
      startDate: ranged[1].trim(),
      endDate: current ? '' : ranged[2].trim(),
      current: Boolean(current && /\b(?:since|present|now)\b/i.test(text)),
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
  if (!sentence || sentence.length < 12) return [];
  return [clipWords(sentence.replace(/\s+/g, ' '), 220)];
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

  const graduatedFrom = text.matchAll(/graduated from\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&.,'’ -]{2,80}?)(?=\s+with\s+|[,.]|$)/gi);
  for (const match of graduatedFrom) {
    const school = presentCompany(match[1].trim());
    if (!school || entries.some(entry => entry.school.toLowerCase() === school.toLowerCase())) continue;
    const window = text.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 180);
    const degree = degreeAfterWith(window);
    entries.push({
      id: `edu-${entries.length + 1}`,
      school,
      degree: degree.degree || 'Degree',
      ...(degree.endDate ? { endDate: degree.endDate } : {}),
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
  const listPattern = /(?:skills?\s+include|tools?\s+include|proficient in|proficient with|familiar with|skilled in|skilled with|擅长|熟悉|技能(?:包括)?\s*[:：]|技术栈\s*[:：]|technologies\s*[:：]|tech stack\s*[:：]|skills?\s*[:：]|tools?\s*[:：])\s*([^.]{2,240})/gi;
  for (const listed of text.matchAll(listPattern)) {
    detected.push(...listed[1].split(/\s*(?:,\s*(?:and|及|与|和)\b|，|、|,|\/|;|\band\b|及|与|和)\s*/i));
  }

  const items = mergeSkillItems(detected);
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

function detectProjects(text: string): ResumeData['projects'] {
  const projects: ResumeData['projects'] = [];
  const patterns = [
    /(?:side project|personal project|open[- ]source project|project)\s*[:：]\s*([^,.\n，。]{2,60})/gi,
    /(?:项目|开源项目)\s*[:：]\s*([^，。\n]{2,40})/g,
    /\b(?:built|created|launched)\s+(?:the\s+)?([A-Z][A-Za-z0-9.+#-]{2,}(?:\s+[A-Z][A-Za-z0-9.+#-]{2,}){0,3})\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanPhrase(match[1]);
      if (!name || projects.some(project => project.name.toLowerCase() === name.toLowerCase())) continue;
      const window = text.slice(match.index || 0, (match.index || 0) + match[0].length + 120);
      const description = window.split(/[.。\n]/)[0]?.replace(/^.*[:：]\s*/, '').trim() || name;
      projects.push({
        id: `project-${projects.length + 1}`,
        name,
        description: description.slice(0, 240),
        bullets: [],
      });
    }
  }

  return projects;
}

function buildSummary(text: string, headline: string, experience: ResumeData['experience'], skills: ResumeData['skills']): string {
  const cleaned = stripContactDetails(text).replace(/\s+/g, ' ').trim();
  const withoutIntro = cleaned.replace(/^(?:my name is|i am|i['’]m|我叫|我是)\s+[^.,，。]{2,40}[,，]\s*/i, '');
  const sentences = withoutIntro
    .split(/(?<=[.。])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 20 && !isContactResidue(sentence) && !isIdentitySentence(sentence))
    .slice(0, 2)
    .join(' ')
    .trim();
  const summary = capitalizeSentence(sentences);
  if (summary.length >= 40 && !containsContactDetails(summary)) return clipWords(summary, 500);

  const skillText = skills[0]?.items.slice(0, 5).join(', ');
  const companyText = experience.map(entry => entry.company).filter(Boolean).slice(0, 2).join(' and ');
  if (companyText && skillText) {
    return `${headline} with experience at ${companyText}, working across ${skillText}. Drafted from source material and ready for review.`;
  }

  return `${headline} with background described in the provided source material. Review this draft for missing details and specificity.`;
}

function stripContactDetails(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/(?:\+|00)?\s*\(?\s*\d[\d\s().-]{8,}\d\)?/g, match => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15 ? ' ' : match;
    })
    .replace(/(?:^|\s)@[A-Za-z0-9._]+(?:\s+on\s+[A-Za-z][A-Za-z0-9]*)?/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?:linkedin|github|dribbble)\.com\/\S+/gi, ' ')
    .replace(/\b(?:e-?mail|phone|tel|mobile|邮箱|电话|微信)\b\s*[:：]?/gi, ' ')
    .replace(/\(\s*[,.\s]*\)/g, ' ')
    .replace(/\(\s*,+/g, ' ')
    .replace(/,{2,}/g, ', ')
    .replace(/\s+([,.;。，])/g, '$1')
    .replace(/(^|\s)[,;]+(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function containsContactDetails(value: string): boolean {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return true;
  for (const match of value.matchAll(/(?:\+|00)?\d[\d\s().-]{8,}\d/g)) {
    if (match[0].replace(/\D/g, '').length >= 10) return true;
  }
  return false;
}

function presentCompany(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').replace(/^(?:the|a|an)\s+/i, '').trim();
  if (!cleaned || /^(?:my|our|this|that|their|building|doing|working|using|and|with)$/i.test(cleaned)) return '';
  if (cleaned === cleaned.toLowerCase()) return tidyLabel(cleaned);
  return cleaned;
}

function tidyLabel(value: string): string {
  const trimmed = cleanPhrase(value);
  if (!trimmed) return '';
  return trimmed.replace(/\b[a-z]/g, char => char.toUpperCase());
}

const DEGREE_MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

function degreeAfterWith(window: string): { degree: string; endDate: string } {
  const match = window.match(/^\s*with\s+([\s\S]+)/i);
  if (!match?.[1]) return { degree: '', endDate: '' };
  const body = match[1];
  let end = body.length;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === ',' || body[index] === '，') {
      end = index;
      break;
    }
    if (body[index] === '.' || body[index] === '。') {
      const token = body.slice(0, index).match(/[A-Za-z]+$/)?.[0] || '';
      const abbreviation = token.length > 0 && token.length <= 2;
      if (!abbreviation) {
        end = index;
        break;
      }
    }
  }
  const dated = splitDegreeDate(body.slice(0, end).replace(/^(?:an?\s+)/i, '').trim());
  return { degree: tidyDegree(dated.degree), endDate: dated.endDate };
}

function splitDegreeDate(value: string): { degree: string; endDate: string } {
  const dated = value.match(new RegExp(`^(.*?)\\s+in\\s+(${DEGREE_MONTH}\\.?\\s+\\d{4})$`, 'i'));
  if (!dated) return { degree: value.trim(), endDate: '' };
  return {
    degree: dated[1].trim(),
    endDate: dated[2].replace(/\./g, '').replace(/\s+/g, ' ').trim(),
  };
}

function tidyDegree(value: string): string {
  const trimmed = cleanPhrase(value).replace(/^(?:an?\s+)/i, '');
  if (!trimmed) return '';
  return trimmed
    .replace(/\b(ph)\.?\s*d\.?(?=\s|$|[,.])/gi, 'Ph.D.')
    .replace(/\b([ABM])\.?\s*([SA])\.?(?=\s|$|[,.])/gi, (_match, first: string, second: string) => `${first.toUpperCase()}.${second.toUpperCase()}.`)
    .replace(/\bmba\b/gi, 'MBA')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeSkillItems(items: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of items) {
    const item = raw.trim().replace(/[.。;；]+$/g, '');
    if (item.length < 2 || item.length > 40 || /@/.test(item) || /^(?:and|or|with|the|a|an|等|和|与)$/i.test(item)) continue;
    const key = item.toLowerCase();
    const known = knownSkills.find(skill => skill.toLowerCase() === key);
    if (!seen.has(key)) seen.set(key, known || item);
  }
  return [...seen.values()];
}

function isContactResidue(sentence: string): boolean {
  const words = sentence.replace(/[^A-Za-z\u4e00-\u9fff]+/g, ' ').trim();
  return words.length < 12;
}

function isIdentitySentence(sentence: string): boolean {
  return new RegExp(`^${nameToken}(?:\\s+${nameToken}){1,2},\\s+\\S`).test(sentence) && !/\$|\d/.test(sentence);
}

function clipWords(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  const slice = trimmed.slice(0, limit + 1);
  const boundary = slice.lastIndexOf(' ');
  const clipped = boundary >= Math.floor(limit * 0.6) ? slice.slice(0, boundary) : trimmed.slice(0, limit);
  return clipped.trim();
}

function capitalizeSentence(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^[a-z]/, char => char.toUpperCase());
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
    .filter(clause => /\b(built|led|mentored|developed|implemented|created|shipped|owned|designed|improved|launched|closed|taught|wrote|grew|delivered|published|reduced|increased|migrated)\b/i.test(clause));

  return clauses.slice(0, 3).map(clause => sentenceCase(clause.replace(/^i\s+/i, '')));
}

function cleanCompany(company: string): string {
  return company
    .replace(/\s+\bas\b[\s\S]*$/i, '')
    .replace(/\b(from|doing|building|until|to|now|present)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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
