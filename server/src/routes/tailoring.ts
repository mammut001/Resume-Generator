import { IncomingMessage, ServerResponse } from 'node:http';
import { RenderHttpError, toRenderError } from '../lib/errors.js';
import { ModelGatewayConfig } from '../intake/modelGateway.js';
import { createIntakeUsageStore, IntakeUsageStore } from '../intake/usageStore.js';
import {
  bucketJobDescriptionLength,
  getTailoringWarningCodes,
  inferTailoringUsedModel,
  shouldRecordValidationFailure,
} from '../observability/events.js';
import { withQuotaReservation } from '../lib/quotaReservation.js';
import { recordDomainEvent } from '../observability/requestContext.js';
import { parseResumeData } from '../tailoring/resumeTailoringSchema.js';
import { buildResumeTailoringResult } from '../tailoring/resumeTailoringService.js';

export const DEFAULT_TAILORING_ATTEMPT_LIMIT = 3;
export const DEFAULT_TAILORING_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_TAILORING_MAX_JOB_DESCRIPTION_CHARS = 30_000;

export type TailoringRouteOptions = {
  tailoringAttemptLimit?: number;
  tailoringMaxBodyBytes?: number;
  tailoringMaxJobDescriptionChars?: number;
  tailoringUsageStore?: IntakeUsageStore;
  modelGatewayConfig?: ModelGatewayConfig;
  allowedOrigin?: string;
};

export function createTailoringRoute(options: TailoringRouteOptions = {}) {
  const maxBodyBytes = options.tailoringMaxBodyBytes || DEFAULT_TAILORING_MAX_BODY_BYTES;
  const maxJobDescriptionChars = options.tailoringMaxJobDescriptionChars || DEFAULT_TAILORING_MAX_JOB_DESCRIPTION_CHARS;
  const usageStore = options.tailoringUsageStore || createIntakeUsageStore(options.tailoringAttemptLimit || DEFAULT_TAILORING_ATTEMPT_LIMIT);

  return async function tailoringRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    setCorsHeaders(req, res, options.allowedOrigin ?? '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/tailor/usage') {
        if (req.method !== 'GET') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        sendJson(res, 200, usageStore.getUsage(req));
        return;
      }

      if (url.pathname === '/api/tailor/resume') {
        if (req.method !== 'POST') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        const payload = await readJsonBody(req, maxBodyBytes);
        const { resume, jobDescription } = validateTailoringPayload(payload, maxJobDescriptionChars);
        recordDomainEvent(req, 'tailoring_requested', {
          jobDescriptionLengthBucket: bucketJobDescriptionLength(jobDescription.length),
        });
        await withQuotaReservation(usageStore, req, async () => {
          const result = await buildResumeTailoringResult(resume, jobDescription, options.modelGatewayConfig);
          recordDomainEvent(req, 'tailoring_completed', {
            warningCodes: getTailoringWarningCodes(result.warnings),
            changeCount: result.changes.length,
            gapCount: result.summary.gaps.length,
            usedModel: inferTailoringUsedModel(result.warnings),
          });
          sendJson(res, 200, result);
        });
        return;
      }

      throw new RenderHttpError(404, 'NOT_FOUND', 'Tailoring route not found.');
    } catch (error) {
      const { statusCode, body } = toRenderError(error);
      if (body.error.code === 'QUOTA_EXCEEDED') {
        recordDomainEvent(req, 'quota_exceeded');
      } else if (shouldRecordValidationFailure(statusCode, body.error.code)) {
        recordDomainEvent(req, 'validation_failed', {
          errorCode: body.error.code,
        });
      }
      sendJsonError(res, error);
    }
  };
}

async function readJsonBody(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBodyBytes) {
      throw new RenderHttpError(413, 'PAYLOAD_TOO_LARGE', `Request body must be ${maxBodyBytes} bytes or less.`);
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new RenderHttpError(400, 'BAD_REQUEST', 'Request body is required.');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RenderHttpError(400, 'BAD_REQUEST', 'Request body must be valid JSON.');
  }
}

function validateTailoringPayload(payload: unknown, maxJobDescriptionChars: number) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const record = payload as Record<string, unknown>;
  const jobDescription = record.jobDescription;
  if (typeof jobDescription !== 'string' || jobDescription.trim().length < 40) {
    throw new RenderHttpError(400, 'TAILORING_NO_JOB_DESCRIPTION', 'Expected jobDescription to contain at least 40 characters.');
  }

  if (jobDescription.length > maxJobDescriptionChars) {
    throw new RenderHttpError(413, 'PAYLOAD_TOO_LARGE', `Job description must be ${maxJobDescriptionChars} characters or less.`);
  }

  return {
    resume: parseResumeData(record.resume),
    jobDescription: jobDescription.trim(),
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendJsonError(res: ServerResponse, error: unknown) {
  const { statusCode, body } = toRenderError(error);
  sendJson(res, statusCode, body);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigin: string) {
  const origin = req.headers.origin;
  const resolvedOrigin = resolveAllowedOrigin(origin, allowedOrigin);

  if (resolvedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', resolvedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function resolveAllowedOrigin(origin: string | undefined, allowedOrigin: string): string | undefined {
  if (allowedOrigin === '*') return '*';
  if (!origin) return undefined;

  const allowedOrigins = allowedOrigin.split(',').map(value => value.trim()).filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : undefined;
}