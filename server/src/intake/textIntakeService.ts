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
      const resume = sanitizeIntakeResume(modelResult.resume, text);
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
    design: defaultDesign,
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

  if (entries.length === 0) {
    warnings.push({ code: 'MISSING_EXPERIENCE', message: 'No experience entries were confidently detected.', fieldPath: 'experience' });
  }

  return entries;
}

function detectEducation(text: string, warnings: ResumeIntakeWarning[]): ResumeData['education'] {
  const educationMatch = text.match(/studied\s+([A-Za-z .&]+?)\s+at\s+([A-Z][A-Za-z .,&-]+?)(?:[,.]|$)/i);
  if (!educationMatch) {
    warnings.push({ code: 'MISSING_EDUCATION', message: 'No education entry was confidently detected.', fieldPath: 'education' });
    return [];
  }

  return [
    {
      id: 'edu-1',
      school: educationMatch[2].trim(),
      degree: 'Degree',
      field: normalizeField(educationMatch[1]),
    },
  ];
}

function detectSkills(text: string, warnings: ResumeIntakeWarning[]): ResumeData['skills'] {
  const lowerText = text.toLowerCase();
  const detected = knownSkills.filter(skill => lowerText.includes(skill.toLowerCase()));

  if (detected.length === 0) {
    warnings.push({ code: 'MISSING_SKILLS', message: 'No recognizable skills were detected.', fieldPath: 'skills' });
    return [];
  }

  return [
    {
      id: 'skill-1',
      category: /[\u4e00-\u9fff]/.test(text) ? '技能' : 'Skills',
      items: Array.from(new Set(detected)),
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
  const skillText = skills[0]?.items.slice(0, 5).join(', ');
  const companyText = experience.map(entry => entry.company).filter(Boolean).slice(0, 2).join(' and ');

  if (companyText && skillText) {
    return `${headline} with experience at ${companyText}, working across ${skillText}. Drafted from source material and ready for review.`;
  }

  return `${headline} with background described in the provided source material. Review this draft for missing details and specificity.`;
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
