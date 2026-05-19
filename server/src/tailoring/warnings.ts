import type { ResumeTailoringWarning } from './types.js';

const stableTailoringCodes = new Set([
  'TAILORING_GAP',
  'TAILORING_LOW_CONFIDENCE',
  'TAILORING_NO_JOB_DESCRIPTION',
  'TAILORING_MODEL_GATEWAY_FAILED',
  'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED',
  'TAILORING_OUTPUT_REPAIRED',
  'TAILORING_UNSUPPORTED_FACT_REMOVED',
]);

export function normalizeTailoringWarnings(warnings: Array<ResumeTailoringWarning | string | unknown>): ResumeTailoringWarning[] {
  const normalized = warnings.flatMap(normalizeWarning).filter((warning): warning is ResumeTailoringWarning => Boolean(warning));
  const seen = new Set<string>();

  return normalized.filter(warning => {
    const key = buildDedupKey(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildGapWarnings(gaps: string[]): ResumeTailoringWarning[] {
  return gaps.map(gap => ({
    code: 'TAILORING_GAP',
    message: `The job description asks for ${gap}, but that is not supported by the current resume.`,
    requirement: gap,
  }));
}

function normalizeWarning(warning: ResumeTailoringWarning | string | unknown): ResumeTailoringWarning[] {
  if (typeof warning === 'string') {
    return [normalizeWarningObject({ code: inferCode('', warning), message: warning })];
  }

  if (!warning || typeof warning !== 'object') return [];

  const raw = warning as Partial<ResumeTailoringWarning>;
  if (typeof raw.message !== 'string' || raw.message.trim().length === 0) return [];

  return [normalizeWarningObject({
    code: inferCode(raw.code || '', raw.message),
    message: raw.message,
    fieldPath: raw.fieldPath,
    requirement: raw.requirement,
  })];
}

function normalizeWarningObject(warning: ResumeTailoringWarning): ResumeTailoringWarning {
  const code = stableTailoringCodes.has(warning.code) ? warning.code : inferCode(warning.code, warning.message);
  return {
    code,
    message: productMessage(code, warning.message, warning.requirement),
    ...(warning.fieldPath ? { fieldPath: warning.fieldPath } : {}),
    ...(warning.requirement ? { requirement: warning.requirement } : {}),
  };
}

function inferCode(rawCode: string, text: string): string {
  if (stableTailoringCodes.has(rawCode)) return rawCode;

  const value = `${rawCode} ${text}`.toLowerCase();

  if (value.includes('tailoring_output_repaired') || value.includes('repaired')) return 'TAILORING_OUTPUT_REPAIRED';
  if (value.includes('not configured')) return 'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED';
  if (value.includes('gateway') || value.includes('model')) return 'TAILORING_MODEL_GATEWAY_FAILED';
  if (value.includes('unsupported') || value.includes('fabricated') || value.includes('removed')) return 'TAILORING_UNSUPPORTED_FACT_REMOVED';
  if (value.includes('low confidence') || value.includes('poor match')) return 'TAILORING_LOW_CONFIDENCE';
  if (value.includes('job description')) return 'TAILORING_NO_JOB_DESCRIPTION';
  if (value.includes('gap') || value.includes('missing')) return 'TAILORING_GAP';

  return 'TAILORING_LOW_CONFIDENCE';
}

function productMessage(code: string, fallback: string, requirement?: string): string {
  switch (code) {
    case 'TAILORING_GAP':
      return requirement
        ? `The job description asks for ${requirement}, but that is not supported by the current resume.`
        : fallback;
    case 'TAILORING_LOW_CONFIDENCE':
      return 'Tailoring confidence is low because the job description has limited overlap with the current resume.';
    case 'TAILORING_NO_JOB_DESCRIPTION':
      return 'Paste a job description before generating a tailored resume.';
    case 'TAILORING_MODEL_GATEWAY_NOT_CONFIGURED':
      return 'This tailored draft used local matching because the model gateway is not configured.';
    case 'TAILORING_MODEL_GATEWAY_FAILED':
      return 'The model gateway could not produce a valid tailoring result, so this draft used local matching instead.';
    case 'TAILORING_OUTPUT_REPAIRED':
      return 'Model output was repaired to match the tailoring schema before review.';
    case 'TAILORING_UNSUPPORTED_FACT_REMOVED':
      return fallback || 'Unsupported tailoring claims were removed before review.';
    default:
      return fallback;
  }
}

function buildDedupKey(warning: ResumeTailoringWarning): string {
  if (warning.code === 'TAILORING_GAP') return `${warning.code}:${warning.requirement || warning.message}`;
  return `${warning.code}:${warning.fieldPath || ''}:${warning.requirement || ''}`;
}