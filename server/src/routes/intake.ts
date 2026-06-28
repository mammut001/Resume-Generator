import { IncomingMessage, ServerResponse } from 'node:http';
import { RenderHttpError, toRenderError } from '../lib/errors.js';
import { analyzePdfDocument, buildPdfAnalysisWarnings } from '../intake/pdfAnalysis.js';
import { buildResumeDraftFromParagraph, buildResumeDraftFromPdfText } from '../intake/textIntakeService.js';
import { ModelGatewayConfig } from '../intake/modelGateway.js';
import { PdfOcrConfig } from '../intake/pdfOcr.js';
import { createIntakeUsageStore, IntakeUsageStore } from '../intake/usageStore.js';
import { extractTextFromPdfBuffer, readPdfPageCount, readPdfUploadRequest, resolvePdfPageRange, slicePdfBufferToPageRange } from '../intake/pdfIntake.js';
import { reconcileWarningsWithResume } from '../intake/warnings.js';
import {
  bucketTextLength,
  countSelectedPages,
  getIntakeWarningCodes,
  inferIntakeUsedModel,
  shouldRecordValidationFailure,
} from '../observability/events.js';
import { withQuotaReservation } from '../lib/quotaReservation.js';
import { recordDomainEvent } from '../observability/requestContext.js';

export const DEFAULT_INTAKE_ATTEMPT_LIMIT = 3;
export const DEFAULT_INTAKE_MAX_BODY_BYTES = 128 * 1024;
export const DEFAULT_INTAKE_MAX_TEXT_CHARS = 20_000;
export const DEFAULT_INTAKE_MAX_PDF_BYTES = 5 * 1024 * 1024;

export type IntakeRouteOptions = {
  intakeAttemptLimit?: number;
  intakeMaxBodyBytes?: number;
  intakeMaxTextChars?: number;
  intakeMaxPdfBytes?: number;
  intakeUsageStore?: IntakeUsageStore;
  modelGatewayConfig?: ModelGatewayConfig;
  pdfOcrConfig?: PdfOcrConfig;
  allowedOrigin?: string;
};

export function createIntakeRoute(options: IntakeRouteOptions = {}) {
  const maxBodyBytes = options.intakeMaxBodyBytes || DEFAULT_INTAKE_MAX_BODY_BYTES;
  const maxTextChars = options.intakeMaxTextChars || DEFAULT_INTAKE_MAX_TEXT_CHARS;
  const maxPdfBytes = options.intakeMaxPdfBytes || DEFAULT_INTAKE_MAX_PDF_BYTES;
  const usageStore = options.intakeUsageStore || createIntakeUsageStore(options.intakeAttemptLimit || DEFAULT_INTAKE_ATTEMPT_LIMIT);

  return async function intakeRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    setCorsHeaders(req, res, options.allowedOrigin ?? '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/intake/usage') {
        if (req.method !== 'GET') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        sendJson(res, 200, usageStore.getUsage(req));
        return;
      }

      if (url.pathname === '/api/intake/text') {
        if (req.method !== 'POST') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        const payload = await readJsonBody(req, maxBodyBytes);
        const text = validateTextPayload(payload, maxTextChars);
        recordDomainEvent(req, 'intake_text_requested', {
          textLengthBucket: bucketTextLength(text.length),
        });
        await withQuotaReservation(usageStore, req, async () => {
          const draft = await buildResumeDraftFromParagraph(text, options.modelGatewayConfig);
          recordDomainEvent(req, 'intake_text_completed', {
            warningCodes: getIntakeWarningCodes(draft.warnings),
            usedModel: inferIntakeUsedModel(draft.warnings),
          });
          sendJson(res, 200, draft);
        });
        return;
      }

      if (url.pathname === '/api/intake/pdf') {
        if (req.method !== 'POST') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        const upload = await readPdfUploadRequest(req, maxPdfBytes);
        const pageCount = await readPdfPageCount(upload.pdfBuffer);
        const selectedPageRange = resolvePdfPageRange(upload.pageStart, upload.pageEnd, pageCount);
        const selectedPageCount = countSelectedPages(selectedPageRange, pageCount);
        recordDomainEvent(req, 'intake_pdf_uploaded', {
          pdfBytes: upload.pdfBuffer.length,
          pageCount,
          selectedPageCount,
        });
        const pdfBuffer = selectedPageRange && (selectedPageRange.start !== 1 || selectedPageRange.end !== pageCount)
          ? await slicePdfBufferToPageRange(upload.pdfBuffer, selectedPageRange)
          : upload.pdfBuffer;
        const extractedText = await extractTextFromPdfBuffer(pdfBuffer, options.pdfOcrConfig);
        const analysis = analyzePdfDocument({
          pageCount,
          extractedText: extractedText.text,
          ...(selectedPageRange ? { analyzedPageRange: selectedPageRange } : {}),
        });
        const analysisWarnings = buildPdfAnalysisWarnings(analysis);

        if (analysis.classification === 'likely_packet') {
          recordDomainEvent(req, 'intake_pdf_packet_blocked', {
            pageCount,
            signalCodes: analysis.signals.map(signal => signal.code),
          });
          sendJson(res, 200, {
            kind: 'selection_required',
            requiresPageSelection: true,
            analysis,
            ...(selectedPageRange ? { selectedPageRange } : {}),
            warnings: analysisWarnings,
          });
          return;
        }

        await withQuotaReservation(usageStore, req, async () => {
          const draft = await buildResumeDraftFromPdfText(extractedText.text, options.modelGatewayConfig);
          const warnings = reconcileWarningsWithResume(draft.resume, [
            ...draft.warnings,
            ...extractedText.warnings,
            ...analysisWarnings,
          ]);
          recordDomainEvent(req, 'intake_pdf_completed', {
            pageCount,
            selectedPageCount,
            usedOcr: extractedText.usedOcr,
            warningCodes: getIntakeWarningCodes(warnings),
            usedModel: inferIntakeUsedModel(draft.warnings),
          });
          sendJson(res, 200, {
            kind: 'draft',
            requiresPageSelection: false,
            analysis,
            ...(selectedPageRange ? { selectedPageRange } : {}),
            draft: {
              ...draft,
              warnings,
            },
          });
        });
        return;
      }

      throw new RenderHttpError(404, 'NOT_FOUND', 'Intake route not found.');
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

function validateTextPayload(payload: unknown, maxTextChars: number): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const text = (payload as Record<string, unknown>).text;
  if (typeof text !== 'string' || text.trim().length < 20) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Expected text to contain at least 20 characters.');
  }

  if (text.length > maxTextChars) {
    throw new RenderHttpError(413, 'PAYLOAD_TOO_LARGE', `Text input must be ${maxTextChars} characters or less.`);
  }

  return text.trim();
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
