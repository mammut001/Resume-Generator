import { RenderHttpError } from './errors.js';

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

export type RenderFormat = 'svg' | 'pdf';

export type RenderTypstRequest = {
  source: string;
  format: RenderFormat;
};

export function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function validateRenderTypstRequest(
  payload: unknown,
  maxSourceBytes = DEFAULT_MAX_BODY_BYTES,
): RenderTypstRequest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.source !== 'string' || candidate.source.trim().length === 0) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Expected a non-empty source string.');
  }

  const sourceBytes = Buffer.byteLength(candidate.source, 'utf8');
  if (sourceBytes > maxSourceBytes) {
    throw new RenderHttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Typst source must be ${maxSourceBytes} bytes or less.`,
    );
  }

  if (candidate.format !== 'svg' && candidate.format !== 'pdf') {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Expected format to be "svg" or "pdf".');
  }

  return {
    source: candidate.source,
    format: candidate.format,
  };
}