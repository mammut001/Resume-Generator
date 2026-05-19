import { validateResumeIntakeResult } from './resumeSchema.js';
import { ResumeIntakeResult, ResumeIntakeWarning } from './types.js';
import { buildMissingFieldWarnings, normalizeIntakeWarnings, reconcileWarningsWithResume } from './warnings.js';

export type ModelGatewayConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ModelGatewayFailureReason =
  | 'timeout'
  | 'http_error'
  | 'network_error'
  | 'empty_response'
  | 'malformed_json'
  | 'schema_invalid';

export class ModelGatewayError extends Error {
  constructor(
    public readonly reason: ModelGatewayFailureReason,
    message: string,
    public readonly repairAttempted = false,
  ) {
    super(message);
    this.name = 'ModelGatewayError';
  }
}

class ModelOutputContractError extends Error {
  constructor(
    public readonly reason: 'malformed_json' | 'schema_invalid',
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'ModelOutputContractError';
  }
}

export function hasModelGatewayConfig(config: ModelGatewayConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

export async function buildResumeDraftWithModel(
  input: string,
  config: ModelGatewayConfig,
): Promise<ResumeIntakeResult> {
  if (!hasModelGatewayConfig(config)) {
    throw new Error('Model gateway is not configured.');
  }

  try {
    const content = await requestModelContent(config, [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: input },
    ]);
    return parseAndValidateModelContent(content);
  } catch (error) {
    if (!(error instanceof ModelOutputContractError)) {
      throw toModelGatewayError(error);
    }

    try {
      const repairedContent = await requestModelContent(config, [
        { role: 'system', content: buildRepairPrompt(input, error.rawOutput, error.message) },
        { role: 'user', content: input },
      ]);
      return withRepairWarning(parseAndValidateModelContent(repairedContent));
    } catch (repairError) {
      const repairFailure = repairError instanceof ModelOutputContractError ? repairError : toModelGatewayError(repairError);
      throw new ModelGatewayError(
        repairFailure.reason,
        repairFailure instanceof ModelOutputContractError
          ? 'Model output repair failed schema validation.'
          : repairFailure.message,
        true,
      );
    }
  }
}

export type ChatMessage = {
  role: 'system' | 'user';
  content: string;
};

export async function requestModelContent(config: ModelGatewayConfig, messages: ChatMessage[]): Promise<string> {
  const fetchImpl = config.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 60_000);

  try {
    const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl!)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ModelGatewayError('http_error', `Model gateway returned ${response.status}.`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new ModelGatewayError('empty_response', 'Model gateway returned no message content.');
    }

    return content;
  } catch (error) {
    throw toModelGatewayError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt(): string {
  return [
    'You extract resume information from messy user prose.',
    'Return only valid JSON. Do not wrap it in markdown.',
    'Do not invent facts, metrics, employers, dates, degrees, links, or contact details that are not present in the source text.',
    'Use this exact top-level JSON shape:',
    JSON.stringify({
      resume: {
        id: 'string',
        title: 'string',
        templateId: 'clean-professional',
        design: {
          typography: 'classic',
          density: 'comfortable',
          pageSize: 'letter',
          accentColor: '#2563eb',
        },
        personal: {
          fullName: 'string',
          headline: 'string',
          email: 'string',
          phone: 'string',
          location: 'string',
          website: 'optional string',
          linkedin: 'optional string',
          github: 'optional string',
        },
        summary: 'string',
        experience: [{
          id: 'string',
          company: 'string',
          role: 'string',
          location: 'optional string',
          startDate: 'string',
          endDate: 'string',
          current: false,
          bullets: ['string'],
        }],
        education: [{
          id: 'string',
          school: 'string',
          degree: 'string',
          field: 'optional string',
          location: 'optional string',
          startDate: 'optional string',
          endDate: 'optional string',
          details: ['optional string'],
        }],
        skills: [{
          id: 'string',
          category: 'string',
          items: ['string'],
        }],
        projects: [{
          id: 'string',
          name: 'string',
          description: 'string',
          url: 'optional string',
          bullets: ['string'],
        }],
      },
      confidence: {
        overall: 0.8,
        sections: {
          personal: 0.8,
          summary: 0.8,
          experience: 0.8,
          education: 0.8,
          skills: 0.8,
          projects: 0.8,
        },
      },
      warnings: [{
        code: 'string',
        message: 'string',
        fieldPath: 'optional string',
      }],
      source: {
        kind: 'paragraph',
      },
    }),
    'Rules:',
    '- If a field is unknown, use an empty string or an empty array rather than guessing.',
    '- If the full name is unknown, use "Imported Candidate".',
    '- Sparse input is valid: return a useful partial resume instead of forcing completeness.',
    '- Empty experience, education, and projects arrays are acceptable when the source does not provide those facts.',
    '- Missing sections should produce warnings, not hallucinated employers, schools, degrees, dates, or metrics.',
    '- For sparse frontend/web-development input, infer a reasonable headline such as "Frontend Engineer" only when supported by the source.',
    '- For incomplete input, write a short summary grounded only in stated skills, target roles, and work themes.',
    '- Use templateId "clean-professional".',
    '- Use design typography "classic", density "comfortable", pageSize "letter", accentColor "#2563eb".',
    '- Warnings should explain missing or uncertain fields.',
    '- IDs may be simple deterministic strings like exp-1, edu-1, skill-1, project-1.',
    '- The source.kind must be "paragraph".',
  ].join('\n');
}

function buildRepairPrompt(input: string, invalidOutput: string, errorMessage: string): string {
  return [
    'You repair JSON for a resume intake pipeline.',
    'Return only corrected valid JSON. Do not wrap it in markdown.',
    'The previous model output did not match the required JSON contract.',
    `Validation problem: ${errorMessage}`,
    'Original user paragraph:',
    input,
    'Invalid previous output:',
    invalidOutput.slice(0, 12_000),
    'Target contract requirements:',
    buildSystemPrompt(),
  ].join('\n\n');
}

function parseAndValidateModelContent(content: string): ResumeIntakeResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(content)) as unknown;
  } catch {
    throw new ModelOutputContractError('malformed_json', 'Model returned malformed JSON.', content);
  }

  try {
    return finalizeModelResult(validateResumeIntakeResult(normalizeModelPayload(parsed)));
  } catch {
    throw new ModelOutputContractError('schema_invalid', 'Model output did not match the required resume schema.', content);
  }
}

function finalizeModelResult(result: ResumeIntakeResult): ResumeIntakeResult {
  return validateResumeIntakeResult({
    ...result,
    warnings: reconcileWarningsWithResume(result.resume, [
      ...result.warnings,
      ...buildMissingFieldWarnings(result.resume, result),
    ]),
  });
}

function withRepairWarning(result: ResumeIntakeResult): ResumeIntakeResult {
  return validateResumeIntakeResult({
    ...result,
    warnings: reconcileWarningsWithResume(result.resume, [
      ...result.warnings,
      {
        code: 'MODEL_OUTPUT_REPAIRED',
        message: 'Model output was repaired to match the resume schema before review.',
      },
    ]),
  });
}

function normalizeModelPayload(payload: unknown): ResumeIntakeResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Model gateway returned a non-object payload.');
  }

  const raw = payload as Record<string, any>;
  const resume = raw.resume || {};
  const rawExperience = Array.isArray(resume.experience) ? resume.experience : [];
  const rawEducation = Array.isArray(resume.education) ? resume.education : [];
  const rawProjects = Array.isArray(resume.projects) ? resume.projects : [];
  const rawSkills = Array.isArray(resume.skills) ? resume.skills : [];
  const warnings = normalizeIntakeWarnings(Array.isArray(raw.warnings) ? raw.warnings : []);
  const overallConfidence = normalizeConfidence(raw.confidence?.overall ?? raw.confidence, 0.7);
  const headline = resume.personal?.headline || resume.title || 'Resume Candidate';
  const skillGroups = normalizeSkills(rawSkills);

  return {
    resume: {
      id: resume.id || 'ai-draft',
      title: resume.documentTitle || `${headline} Resume`,
      templateId: resume.templateId || 'clean-professional',
      design: {
        typography: resume.design?.typography || 'classic',
        density: resume.design?.density || 'comfortable',
        pageSize: resume.design?.pageSize || 'letter',
        accentColor: resume.design?.accentColor || '#2563eb',
      },
      personal: {
        fullName: resume.personal?.fullName || resume.name || 'Imported Candidate',
        headline,
        email: resume.personal?.email || resume.email || '',
        phone: resume.personal?.phone || resume.phone || '',
        location: resume.personal?.location || resume.location || '',
        ...(resume.personal?.website || resume.website ? { website: resume.personal?.website || resume.website } : {}),
        ...(resume.personal?.linkedin || resume.linkedin ? { linkedin: resume.personal?.linkedin || resume.linkedin } : {}),
        ...(resume.personal?.github || resume.github ? { github: resume.personal?.github || resume.github } : {}),
      },
      summary: resume.summary || '',
      experience: rawExperience.map((entry: any, index: number) => ({
        id: entry.id || `exp-${index + 1}`,
        company: entry.company || '',
        role: entry.role || headline,
        ...(entry.location ? { location: entry.location } : {}),
        startDate: entry.startDate || entry.start || '',
        endDate: normalizeEndDate(entry.endDate || entry.end || ''),
        current: Boolean(entry.current || /^(present|now|至今)$/i.test(entry.end || entry.endDate || '')),
        bullets: normalizeStringArray(entry.bullets || entry.highlights || entry.responsibilities),
      })),
      education: rawEducation.map((entry: any, index: number) => ({
        id: entry.id || `edu-${index + 1}`,
        school: entry.school || '',
        degree: entry.degree || 'Degree',
        ...(entry.field ? { field: entry.field } : {}),
        ...(entry.location ? { location: entry.location } : {}),
        ...(entry.startDate || entry.start ? { startDate: entry.startDate || entry.start } : {}),
        ...(entry.endDate || entry.end || entry.graduation ? { endDate: entry.endDate || entry.end || entry.graduation } : {}),
        ...(entry.details ? { details: normalizeStringArray(entry.details) } : {}),
      })),
      skills: skillGroups,
      projects: rawProjects.map((entry: any, index: number) => ({
        id: entry.id || `project-${index + 1}`,
        name: entry.name || '',
        description: entry.description || '',
        ...(entry.url ? { url: entry.url } : {}),
        bullets: normalizeStringArray(entry.bullets || entry.highlights),
      })),
    },
    confidence: {
      overall: overallConfidence,
      sections: {
        personal: normalizeConfidence(raw.confidence?.sections?.personal, overallConfidence),
        summary: normalizeConfidence(raw.confidence?.sections?.summary, overallConfidence),
        experience: normalizeConfidence(raw.confidence?.sections?.experience, rawExperience.length ? overallConfidence : 0.2),
        education: normalizeConfidence(raw.confidence?.sections?.education, rawEducation.length ? overallConfidence : 0.2),
        skills: normalizeConfidence(raw.confidence?.sections?.skills, skillGroups.length ? overallConfidence : 0.2),
        projects: normalizeConfidence(raw.confidence?.sections?.projects, rawProjects.length ? overallConfidence : 0.2),
      },
    },
    warnings,
    source: {
      kind: 'paragraph',
    },
  };
}

function normalizeSkills(value: unknown[]): ResumeIntakeResult['resume']['skills'] {
  if (value.length === 0) return [];
  if (value.every(item => typeof item === 'string')) {
    return [{
      id: 'skill-1',
      category: 'Detected Skills',
      items: normalizeStringArray(value),
    }];
  }

  return value
    .filter(item => item && typeof item === 'object')
    .map((item: any, index) => ({
      id: item.id || `skill-${index + 1}`,
      category: item.category || 'Skills',
      items: normalizeStringArray(item.items),
    }))
    .filter(group => group.items.length > 0);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeConfidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function normalizeEndDate(value: string): string {
  return /^(present|now|至今)$/i.test(value) ? '' : value;
}

function toModelGatewayError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) return error;

  if (error instanceof ModelOutputContractError) {
    return new ModelGatewayError(error.reason, error.message);
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new ModelGatewayError('timeout', 'Model gateway timed out.');
  }

  return new ModelGatewayError('network_error', 'Model gateway request failed.');
}

function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
