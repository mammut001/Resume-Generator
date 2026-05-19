import type { ResumeData, ResumeExperience, ResumeProject, ResumeSkill } from '../intake/types.js';
import { hasModelGatewayConfig, ModelGatewayConfig, ModelGatewayError, requestModelContent } from '../intake/modelGateway.js';
import { validateResumeTailoringResult } from './resumeTailoringSchema.js';
import { buildGapWarnings, normalizeTailoringWarnings } from './warnings.js';
import type { ResumeTailoringChange, ResumeTailoringResult, ResumeTailoringWarning } from './types.js';

class TailoringModelOutputContractError extends Error {
  constructor(
    public readonly reason: 'malformed_json' | 'schema_invalid',
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'TailoringModelOutputContractError';
  }
}

const knownRequirementTerms = [
  'TypeScript',
  'JavaScript',
  'React',
  'Next.js',
  'Vue',
  'Angular',
  'Node',
  'Python',
  'GraphQL',
  'REST',
  'Tailwind',
  'Figma',
  'Jest',
  'Playwright',
  'Cypress',
  'Design Systems',
  'Accessibility',
  'Performance',
  'Testing',
  'AWS',
  'Kubernetes',
  'Docker',
  'SQL',
  'Data Visualization',
  'Tableau',
  'Machine Learning',
  'Spark',
  'Roadmap Planning',
  'Product Discovery',
  'User Stories',
  'Analytics',
  'Enterprise SaaS',
  'Product Strategy',
  'User Research',
  'IRB',
  'R Analysis',
  'Patient Care',
  'Epic',
  'Medication Administration',
  'Discharge Education',
  'BLS',
  'RN License',
  'Leadership',
  'Mentoring',
];

const targetRolePatterns = [
  /(?:job title|title|role)\s*[:\-]\s*([^\n.]+)/i,
  /(?:hiring|seeking|looking for)\s+(?:an?\s+)?([^\n.]{3,80}?(?:engineer|developer|designer|manager|analyst|lead|specialist))/i,
  /\b(frontend platform engineer|frontend engineer|front-end engineer|software engineer|full stack engineer|backend engineer|product designer|product manager|data analyst)\b/i,
];

export async function buildResumeTailoringResult(
  sourceResume: ResumeData,
  jobDescription: string,
  modelGatewayConfig: ModelGatewayConfig = {},
): Promise<ResumeTailoringResult> {
  const normalizedJobDescription = normalizeWhitespace(jobDescription);

  if (hasModelGatewayConfig(modelGatewayConfig)) {
    try {
      return await buildTailoringWithModel(sourceResume, normalizedJobDescription, modelGatewayConfig);
    } catch (error) {
      return buildLocalTailoringResult(sourceResume, normalizedJobDescription, [buildGatewayFailureWarning(error)]);
    }
  }

  return buildLocalTailoringResult(sourceResume, normalizedJobDescription, [{
    code: 'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED',
    message: 'This tailored draft used local matching because the model gateway is not configured.',
  }]);
}

async function buildTailoringWithModel(
  sourceResume: ResumeData,
  jobDescription: string,
  config: ModelGatewayConfig,
): Promise<ResumeTailoringResult> {
  try {
    const content = await requestModelContent(config, [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(sourceResume, jobDescription) },
    ]);
    return parseAndFinalizeModelContent(content, sourceResume, jobDescription);
  } catch (error) {
    if (!(error instanceof TailoringModelOutputContractError)) {
      throw error;
    }

    try {
      const repairedContent = await requestModelContent(config, [
        { role: 'system', content: buildRepairPrompt(sourceResume, jobDescription, error.rawOutput, error.message) },
        { role: 'user', content: buildUserPrompt(sourceResume, jobDescription) },
      ]);
      const repairedResult = parseAndFinalizeModelContent(repairedContent, sourceResume, jobDescription);
      return validateResumeTailoringResult({
        ...repairedResult,
        warnings: normalizeTailoringWarnings([
          ...repairedResult.warnings,
          {
            code: 'TAILORING_OUTPUT_REPAIRED',
            message: 'Model output was repaired to match the tailoring schema before review.',
          },
        ]),
      });
    } catch (repairError) {
      throw repairError instanceof TailoringModelOutputContractError
        ? new ModelGatewayError(repairError.reason, 'Model output repair failed schema validation.', true)
        : repairError;
    }
  }
}

function parseAndFinalizeModelContent(content: string, sourceResume: ResumeData, jobDescription: string): ResumeTailoringResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(content)) as unknown;
  } catch {
    throw new TailoringModelOutputContractError('malformed_json', 'Model returned malformed JSON.', content);
  }

  try {
    const candidate = validateResumeTailoringResult(normalizeModelPayload(parsed, sourceResume));
    return finalizeTailoringResult(sourceResume, candidate, jobDescription);
  } catch {
    throw new TailoringModelOutputContractError('schema_invalid', 'Model output did not match the tailoring schema.', content);
  }
}

function normalizeModelPayload(payload: unknown, sourceResume: ResumeData): ResumeTailoringResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Model returned a non-object tailoring payload.');
  }

  const raw = payload as Record<string, any>;
  if ((!raw.tailoredResume && !raw.resume) || !raw.summary || !Array.isArray(raw.changes)) {
    throw new Error('Model tailoring payload is missing required top-level fields.');
  }

  return {
    tailoredResume: raw.tailoredResume || raw.resume || sourceResume,
    summary: {
      ...(raw.summary || {}),
      keyRequirements: normalizeStringArray(raw.summary?.keyRequirements || raw.keyRequirements),
      matchedStrengths: normalizeStringArray(raw.summary?.matchedStrengths || raw.matchedStrengths),
      gaps: normalizeStringArray(raw.summary?.gaps || raw.gaps),
    },
    changes: Array.isArray(raw.changes) ? raw.changes : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}

function finalizeTailoringResult(sourceResume: ResumeData, result: ResumeTailoringResult, jobDescription: string): ResumeTailoringResult {
  const safetyWarnings: ResumeTailoringWarning[] = [];
  const tailoredResume = sanitizeTailoredResume(sourceResume, result.tailoredResume, safetyWarnings);
  const summary = normalizeSummary(result.summary, sourceResume, jobDescription);
  const normalizedChanges = result.changes.length > 0 ? normalizeChanges(result.changes) : [];
  const changesWithTargetPaths = normalizedChanges.map(change => change.targetPath
    ? change
    : { ...change, ...inferTargetPathForChange(sourceResume, tailoredResume, change) });
  const sanitizedChanges = filterChangesToSanitizedResume(sourceResume, tailoredResume, changesWithTargetPaths);
  const changes = sanitizedChanges.length > 0 ? sanitizedChanges : inferChanges(sourceResume, tailoredResume, summary.targetRole);

  return validateResumeTailoringResult({
    tailoredResume,
    summary,
    changes,
    warnings: normalizeTailoringWarnings([
      ...result.warnings,
      ...safetyWarnings,
      ...buildGapWarnings(summary.gaps),
      ...(summary.keyRequirements.length > 0 && summary.matchedStrengths.length / summary.keyRequirements.length < 0.3 ? [{
        code: 'TAILORING_LOW_CONFIDENCE',
        message: 'Tailoring confidence is low because the job description has limited overlap with the current resume.',
      }] : []),
    ]),
  });
}

function buildLocalTailoringResult(sourceResume: ResumeData, jobDescription: string, extraWarnings: ResumeTailoringWarning[] = []): ResumeTailoringResult {
  const targetRole = detectTargetRole(jobDescription);
  const keyRequirements = extractKeyRequirements(jobDescription);
  const resumeText = resumeToFactText(sourceResume).toLowerCase();
  const matchedStrengths = keyRequirements.filter(requirement => resumeText.includes(requirement.toLowerCase()));
  const gaps = keyRequirements.filter(requirement => !resumeText.includes(requirement.toLowerCase()));
  const tailoredResume = buildLocalTailoredResume(sourceResume, keyRequirements, matchedStrengths, targetRole);
  const changes = inferChanges(sourceResume, tailoredResume, targetRole);

  return validateResumeTailoringResult({
    tailoredResume,
    summary: {
      ...(targetRole ? { targetRole } : {}),
      keyRequirements,
      matchedStrengths,
      gaps,
    },
    changes,
    warnings: normalizeTailoringWarnings([
      ...extraWarnings,
      ...buildGapWarnings(gaps),
      ...(keyRequirements.length > 0 && matchedStrengths.length / keyRequirements.length < 0.3 ? [{
        code: 'TAILORING_LOW_CONFIDENCE',
        message: 'Tailoring confidence is low because the job description has limited overlap with the current resume.',
      }] : []),
    ]),
  });
}

function buildLocalTailoredResume(sourceResume: ResumeData, keyRequirements: string[], matchedStrengths: string[], targetRole?: string): ResumeData {
  const tailoredResume = cloneResume(sourceResume);
  tailoredResume.id = `tailored-${sourceResume.id}`;
  tailoredResume.title = targetRole ? `${sourceResume.title} - Tailored for ${targetRole}` : `${sourceResume.title} - Tailored`;
  tailoredResume.summary = buildTailoredSummary(sourceResume, matchedStrengths, targetRole);
  tailoredResume.experience = sourceResume.experience.map(entry => ({
    ...entry,
    bullets: rankStrings(entry.bullets, keyRequirements),
  }));
  tailoredResume.skills = sourceResume.skills.map(group => ({
    ...group,
    items: rankStrings(group.items, keyRequirements),
  }));
  tailoredResume.projects = sourceResume.projects.map(project => ({
    ...project,
    bullets: rankStrings(project.bullets, keyRequirements),
  }));
  return tailoredResume;
}

function sanitizeTailoredResume(sourceResume: ResumeData, candidate: ResumeData, warnings: ResumeTailoringWarning[]): ResumeData {
  const sourceFactText = resumeToFactText(sourceResume);
  const tailoredResume: ResumeData = {
    ...cloneResume(sourceResume),
    id: candidate.id || `tailored-${sourceResume.id}`,
    title: candidate.title?.trim() || `${sourceResume.title} - Tailored`,
    personal: {
      ...sourceResume.personal,
      headline: sanitizeProseField(sourceResume.personal.headline, candidate.personal?.headline, sourceFactText, warnings, 'personal.headline'),
    },
    summary: sanitizeProseField(sourceResume.summary, candidate.summary, sourceFactText, warnings, 'summary'),
    experience: sourceResume.experience.map((entry, index) => sanitizeExperience(entry, candidate.experience, sourceFactText, warnings, index)),
    education: cloneResume(sourceResume).education,
    skills: sanitizeSkills(sourceResume.skills, candidate.skills, warnings),
    projects: sourceResume.projects.map((project, index) => sanitizeProject(project, candidate.projects, sourceFactText, warnings, index)),
    templateId: sourceResume.templateId,
    design: sourceResume.design,
  };

  if (candidate.experience.length > sourceResume.experience.length) {
    warnings.push({
      code: 'TAILORING_UNSUPPORTED_FACT_REMOVED',
      message: 'One or more unsupported experience entries were removed before review.',
      fieldPath: 'experience',
    });
  }

  if (candidate.education.length !== sourceResume.education.length) {
    warnings.push({
      code: 'TAILORING_UNSUPPORTED_FACT_REMOVED',
      message: 'Unsupported education changes were removed before review.',
      fieldPath: 'education',
    });
  }

  return tailoredResume;
}

function sanitizeExperience(sourceEntry: ResumeExperience, candidateEntries: ResumeExperience[], sourceFactText: string, warnings: ResumeTailoringWarning[], index: number): ResumeExperience {
  const candidate = candidateEntries.find(entry => entry.id === sourceEntry.id)
    || candidateEntries.find(entry => entry.company === sourceEntry.company && entry.role === sourceEntry.role);
  const bullets = sanitizeBullets(sourceEntry.bullets, candidate?.bullets, sourceFactText, warnings, `experience.${index}.bullets`);
  return { ...sourceEntry, bullets };
}

function sanitizeProject(sourceProject: ResumeProject, candidateProjects: ResumeProject[], sourceFactText: string, warnings: ResumeTailoringWarning[], index: number): ResumeProject {
  const candidate = candidateProjects.find(project => project.id === sourceProject.id)
    || candidateProjects.find(project => project.name === sourceProject.name);
  const bullets = sanitizeBullets(sourceProject.bullets, candidate?.bullets, sourceFactText, warnings, `projects.${index}.bullets`);
  return {
    ...sourceProject,
    description: sanitizeProseField(sourceProject.description, candidate?.description, sourceFactText, warnings, `projects.${index}.description`),
    bullets,
  };
}

function sanitizeProseField(sourceValue: string, candidateValue: string | undefined, sourceFactText: string, warnings: ResumeTailoringWarning[], fieldPath: string): string {
  const value = candidateValue?.trim();
  if (!value) return sourceValue;

  if (hasUnsupportedNumber(value, sourceFactText) || hasUnsupportedKnownTerm(value, sourceFactText)) {
    warnings.push({
      code: 'TAILORING_UNSUPPORTED_FACT_REMOVED',
      message: `Unsupported claim removed from ${fieldPath}.`,
      fieldPath,
    });
    return sourceValue;
  }

  return value;
}

function sanitizeBullets(sourceBullets: string[], candidateBullets: string[] | undefined, sourceFactText: string, warnings: ResumeTailoringWarning[], fieldPath: string): string[] {
  if (!candidateBullets || candidateBullets.length === 0) return sourceBullets;

  const accepted = candidateBullets
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, Math.max(sourceBullets.length, 1))
    .filter(value => {
      if (hasUnsupportedNumber(value, sourceFactText) || hasUnsupportedKnownTerm(value, sourceFactText)) {
        warnings.push({
          code: 'TAILORING_UNSUPPORTED_FACT_REMOVED',
          message: `Unsupported claim removed from ${fieldPath}.`,
          fieldPath,
        });
        return false;
      }
      return true;
    });

  return accepted.length > 0 ? accepted : sourceBullets;
}

function sanitizeSkills(sourceSkills: ResumeSkill[], candidateSkills: ResumeSkill[], warnings: ResumeTailoringWarning[]): ResumeSkill[] {
  const sourceItems = sourceSkills.flatMap(group => group.items);
  const sourceItemSet = new Set(sourceItems.map(normalizeToken));
  const candidateOrder = new Map<string, number>();

  candidateSkills.flatMap(group => group.items).forEach((item, index) => {
    const key = normalizeToken(item);
    if (sourceItemSet.has(key)) {
      candidateOrder.set(key, index);
      return;
    }

    warnings.push({
      code: 'TAILORING_UNSUPPORTED_FACT_REMOVED',
      message: `Unsupported skill "${item}" was removed before review.`,
      fieldPath: 'skills',
    });
  });

  return sourceSkills.map(group => ({
    ...group,
    items: [...group.items].sort((left, right) => {
      const leftIndex = candidateOrder.get(normalizeToken(left)) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = candidateOrder.get(normalizeToken(right)) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    }),
  }));
}

function normalizeSummary(summary: ResumeTailoringResult['summary'], sourceResume: ResumeData, jobDescription: string): ResumeTailoringResult['summary'] {
  const keyRequirements = normalizeStringArray(summary.keyRequirements).length > 0
    ? normalizeStringArray(summary.keyRequirements)
    : extractKeyRequirements(jobDescription);
  const resumeText = resumeToFactText(sourceResume).toLowerCase();
  const matchedStrengths = normalizeStringArray(summary.matchedStrengths).filter(strength => resumeText.includes(strength.toLowerCase()))
    || keyRequirements.filter(requirement => resumeText.includes(requirement.toLowerCase()));
  const gaps = normalizeStringArray(summary.gaps).length > 0
    ? normalizeStringArray(summary.gaps)
    : keyRequirements.filter(requirement => !resumeText.includes(requirement.toLowerCase()));

  return {
    ...(summary.targetRole ? { targetRole: summary.targetRole.trim() } : detectTargetRole(jobDescription) ? { targetRole: detectTargetRole(jobDescription) } : {}),
    keyRequirements,
    matchedStrengths,
    gaps,
  };
}

function normalizeChanges(changes: ResumeTailoringChange[]): ResumeTailoringChange[] {
  return changes
    .filter(change => change.id && change.section && change.kind && change.description)
    .map(change => ({
      id: change.id,
      section: change.section,
      kind: change.kind,
      description: change.description,
      ...(change.targetPath ? { targetPath: change.targetPath } : {}),
      ...(change.before ? { before: change.before } : {}),
      ...(change.after ? { after: change.after } : {}),
      ...(change.reason ? { reason: change.reason } : {}),
    }));
}

function filterChangesToSanitizedResume(sourceResume: ResumeData, tailoredResume: ResumeData, changes: ResumeTailoringChange[]): ResumeTailoringChange[] {
  if (changes.length === 0) return [];

  const sourceText = resumeToFactText(sourceResume);
  const tailoredText = resumeToFactText(tailoredResume);
  return changes.filter(change => {
    const beforeMatches = !change.before || sourceText.includes(change.before);
    const afterMatches = !change.after || tailoredText.includes(change.after);
    return beforeMatches && afterMatches;
  });
}

function inferTargetPathForChange(sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange): Pick<ResumeTailoringChange, 'targetPath'> {
  if (change.section === 'summary') return { targetPath: 'summary' };
  if (change.section === 'skills') return { targetPath: 'skills' };

  if (change.section === 'experience') {
    const path = inferBulletTargetPath(
      sourceResume.experience.map(entry => entry.bullets),
      tailoredResume.experience.map(entry => entry.bullets),
      'experience',
      change,
    );
    return path ? { targetPath: path } : {};
  }

  if (change.section === 'projects') {
    const descriptionPath = inferProjectDescriptionTargetPath(sourceResume, tailoredResume, change);
    if (descriptionPath) return { targetPath: descriptionPath };

    const path = inferBulletTargetPath(
      sourceResume.projects.map(project => project.bullets),
      tailoredResume.projects.map(project => project.bullets),
      'projects',
      change,
    );
    return path ? { targetPath: path } : {};
  }

  return {};
}

function inferBulletTargetPath(sourceGroups: string[][], tailoredGroups: string[][], section: 'experience' | 'projects', change: ResumeTailoringChange): string | undefined {
  for (const [groupIndex, sourceBullets] of sourceGroups.entries()) {
    const tailoredBullets = tailoredGroups[groupIndex] || [];
    if (change.before && sourceBullets.join('\n') === change.before) return `${section}.${groupIndex}.bullets`;

    if (change.before) {
      const bulletIndex = sourceBullets.findIndex(bullet => bullet === change.before);
      if (bulletIndex >= 0) return `${section}.${groupIndex}.bullets.${bulletIndex}`;
    }

    if (change.after) {
      const bulletIndex = tailoredBullets.findIndex(bullet => bullet === change.after);
      if (bulletIndex >= 0) return `${section}.${groupIndex}.bullets.${bulletIndex}`;
    }
  }

  return undefined;
}

function inferProjectDescriptionTargetPath(sourceResume: ResumeData, tailoredResume: ResumeData, change: ResumeTailoringChange): string | undefined {
  for (const [index, project] of sourceResume.projects.entries()) {
    if (change.before && project.description === change.before) return `projects.${index}.description`;
    if (change.after && tailoredResume.projects[index]?.description === change.after) return `projects.${index}.description`;
  }

  return undefined;
}

function inferChanges(sourceResume: ResumeData, tailoredResume: ResumeData, targetRole?: string): ResumeTailoringChange[] {
  const changes: ResumeTailoringChange[] = [];

  if (sourceResume.summary !== tailoredResume.summary) {
    changes.push({
      id: 'change-summary',
      section: 'summary',
      kind: 'rewritten',
      description: targetRole ? `Rewrote summary toward ${targetRole}.` : 'Rewrote summary toward the pasted job description.',
      targetPath: 'summary',
      before: sourceResume.summary,
      after: tailoredResume.summary,
    });
  }

  for (const [index, entry] of tailoredResume.experience.entries()) {
    if (sourceResume.experience[index] && sourceResume.experience[index].bullets.join('\n') !== entry.bullets.join('\n')) {
      changes.push({
        id: `change-experience-${entry.id}`,
        section: 'experience',
        kind: 'emphasized',
        description: `Re-ranked bullets for ${entry.role} at ${entry.company}.`,
        targetPath: `experience.${index}.bullets`,
        before: sourceResume.experience[index].bullets.join('\n'),
        after: entry.bullets.join('\n'),
      });
    }
  }

  if (sourceResume.skills.map(group => group.items.join(',')).join('|') !== tailoredResume.skills.map(group => group.items.join(',')).join('|')) {
    changes.push({
      id: 'change-skills',
      section: 'skills',
      kind: 'reordered',
      description: 'Reordered skills to surface job-relevant strengths first.',
      targetPath: 'skills',
      before: sourceResume.skills.flatMap(group => group.items).join(', '),
      after: tailoredResume.skills.flatMap(group => group.items).join(', '),
    });
  }

  return changes;
}

function buildSystemPrompt(): string {
  return [
    'You tailor an existing resume to a pasted job description.',
    'Return only valid JSON. Do not wrap it in markdown.',
    'Truth is the top priority: use only facts already present in the source resume.',
    'Never invent employers, schools, dates, metrics, tools, achievements, degrees, links, or contact details.',
    'If the job asks for something absent from the resume, list it as a gap instead of adding it to the resume.',
    'Prefer relevance over embellishment. Keep the resume concise and ATS-friendly.',
    'You may rewrite the summary, reorder skills, and reorder or lightly rewrite existing bullets.',
    'Do not add new experience, education, or project entries.',
    'Use this exact top-level JSON shape:',
    JSON.stringify({
      tailoredResume: 'ResumeData object',
      summary: {
        targetRole: 'optional string',
        keyRequirements: ['string'],
        matchedStrengths: ['string'],
        gaps: ['string'],
      },
      changes: [{
        id: 'string',
        section: 'summary | experience | skills | projects',
        kind: 'rewritten | reordered | removed | emphasized',
        description: 'string',
        targetPath: 'optional path such as summary, experience.0.bullets.1, skills, or projects.0.description',
        before: 'optional string',
        after: 'optional string',
        reason: 'optional string',
      }],
      warnings: [{
        code: 'string',
        message: 'string',
        fieldPath: 'optional string',
        requirement: 'optional string',
      }],
    }),
  ].join('\n');
}

function buildUserPrompt(sourceResume: ResumeData, jobDescription: string): string {
  return JSON.stringify({ sourceResume, jobDescription });
}

function buildRepairPrompt(sourceResume: ResumeData, jobDescription: string, invalidOutput: string, errorMessage: string): string {
  return [
    'You repair JSON for a resume tailoring pipeline.',
    'Return only corrected valid JSON. Do not wrap it in markdown.',
    'The previous model output did not match the required tailoring contract.',
    `Validation problem: ${errorMessage}`,
    'Source resume and job description:',
    buildUserPrompt(sourceResume, jobDescription),
    'Invalid previous output:',
    invalidOutput.slice(0, 12_000),
    'Target contract requirements:',
    buildSystemPrompt(),
  ].join('\n\n');
}

function buildTailoredSummary(sourceResume: ResumeData, matchedStrengths: string[], targetRole?: string): string {
  const strengths = matchedStrengths.slice(0, 4).join(', ');
  if (targetRole && strengths) {
    return `${sourceResume.personal.headline} focused on ${targetRole} roles, with demonstrated experience across ${strengths}. ${sourceResume.summary}`.trim();
  }

  if (targetRole) {
    return `${sourceResume.personal.headline} tailoring this resume toward ${targetRole} opportunities while preserving only verified source-resume facts. ${sourceResume.summary}`.trim();
  }

  return sourceResume.summary;
}

function extractKeyRequirements(jobDescription: string): string[] {
  const lowerDescription = jobDescription.toLowerCase();
  const detected = knownRequirementTerms.filter(term => lowerDescription.includes(term.toLowerCase()));
  return Array.from(new Set(detected)).slice(0, 12);
}

function detectTargetRole(jobDescription: string): string | undefined {
  for (const pattern of targetRolePatterns) {
    const match = pattern.exec(jobDescription);
    if (match?.[1]) return titleCase(match[1].trim().replace(/\s+/g, ' '));
    if (match?.[0]) return titleCase(match[0].trim().replace(/\s+/g, ' '));
  }

  return undefined;
}

function rankStrings(values: string[], keyRequirements: string[]): string[] {
  return [...values].sort((left, right) => scoreText(right, keyRequirements) - scoreText(left, keyRequirements));
}

function scoreText(value: string, keyRequirements: string[]): number {
  const lowerValue = value.toLowerCase();
  return keyRequirements.reduce((score, requirement) => score + (lowerValue.includes(requirement.toLowerCase()) ? 1 : 0), 0);
}

function resumeToFactText(resume: ResumeData): string {
  return [
    resume.title,
    resume.personal.fullName,
    resume.personal.headline,
    resume.summary,
    ...resume.experience.flatMap(entry => [entry.company, entry.role, entry.location || '', entry.startDate, entry.endDate, ...entry.bullets]),
    ...resume.education.flatMap(entry => [entry.school, entry.degree, entry.field || '', entry.location || '', entry.startDate || '', entry.endDate || '', ...(entry.details || [])]),
    ...resume.skills.flatMap(group => [group.category, ...group.items]),
    ...resume.projects.flatMap(project => [project.name, project.description, project.url || '', ...project.bullets]),
  ].join(' ');
}

function hasUnsupportedNumber(value: string, sourceFactText: string): boolean {
  const sourceNumbers = new Set(extractNumbers(sourceFactText));
  return extractNumbers(value).some(number => !sourceNumbers.has(number));
}

function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/\$?\b\d+(?:\.\d+)?%?\b/g)).map(match => match[0].toLowerCase());
}

function hasUnsupportedKnownTerm(value: string, sourceFactText: string): boolean {
  const lowerSource = sourceFactText.toLowerCase();
  const lowerValue = value.toLowerCase();
  return knownRequirementTerms.some(term => lowerValue.includes(term.toLowerCase()) && !lowerSource.includes(term.toLowerCase()));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function stripCodeFence(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
}

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map(word => word.length <= 3 && word === word.toUpperCase() ? word : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function cloneResume<T extends ResumeData>(resume: T): T {
  return JSON.parse(JSON.stringify(resume)) as T;
}

function buildGatewayFailureWarning(error: unknown): ResumeTailoringWarning {
  if (error instanceof ModelGatewayError) {
    const repairSuffix = error.repairAttempted ? ' after one schema repair attempt' : '';
    return {
      code: 'TAILORING_MODEL_GATEWAY_FAILED',
      message: `The model gateway could not produce a valid tailoring result${repairSuffix}, so this draft used local matching instead.`,
    };
  }

  return {
    code: 'TAILORING_MODEL_GATEWAY_FAILED',
    message: 'The model gateway could not produce a valid tailoring result, so this draft used local matching instead.',
  };
}