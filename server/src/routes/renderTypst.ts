import { IncomingMessage, ServerResponse } from 'node:http';
import { RenderHttpError, toRenderError } from '../lib/errors.js';
import { createRateLimiter } from '../lib/rateLimiter.js';
import { setSecurityHeaders } from '../lib/securityHeaders.js';
import { resolveClientIp } from '../observability/ip.js';
import { recordDomainEvent } from '../observability/requestContext.js';
import { DEFAULT_MAX_BODY_BYTES, validateRenderTypstRequest } from '../lib/validation.js';
import { compileTypst, getRenderContentType, TypstCompileOptions } from '../services/typstService.js';

const DEFAULT_RENDER_RATE_LIMIT = 120;
const RENDER_RATE_WINDOW_MS = 60_000;

export type RenderTypstRouteOptions = TypstCompileOptions & {
  maxBodyBytes?: number;
  allowedOrigin?: string;
  renderRateLimitPerMinute?: number;
  trustProxy?: boolean;
};

export function createRenderTypstRoute(options: RenderTypstRouteOptions = {}) {
  const maxBodyBytes = options.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;
  const rateLimiter = createRateLimiter({
    limit: options.renderRateLimitPerMinute ?? DEFAULT_RENDER_RATE_LIMIT,
    windowMs: RENDER_RATE_WINDOW_MS,
  });
  const trustProxy = options.trustProxy ?? false;

  return async function renderTypstRoute(req: IncomingMessage, res: ServerResponse) {
    setSecurityHeaders(res);
    setCorsHeaders(req, res, options.allowedOrigin ?? '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      sendJsonError(res, new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
      return;
    }

    const clientIp = resolveClientIp(req, trustProxy) || 'unknown';
    if (!rateLimiter.consume(clientIp)) {
      sendJsonError(res, new RenderHttpError(429, 'QUOTA_EXCEEDED', 'Too many render requests.'));
      return;
    }

    let renderRequest: ReturnType<typeof validateRenderTypstRequest> | undefined;
    let renderStartedAt: bigint | undefined;

    try {
      const payload = await readJsonBody(req, maxBodyBytes);
      renderRequest = validateRenderTypstRequest(payload, maxBodyBytes);
      renderStartedAt = process.hrtime.bigint();
      recordDomainEvent(req, 'render_requested', {
        format: renderRequest.format,
        sourceBytes: Buffer.byteLength(renderRequest.source, 'utf8'),
      });
      const output = await compileTypst(renderRequest, options);

      recordDomainEvent(req, 'render_completed', {
        format: renderRequest.format,
        durationMs: Math.max(0, Math.round(Number(process.hrtime.bigint() - renderStartedAt) / 1_000_000)),
        responseBytes: output.length,
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', getRenderContentType(renderRequest.format));
      res.setHeader('Cache-Control', 'no-store');
      res.end(output);
    } catch (error) {
      recordDomainEvent(req, 'render_failed', {
        ...(renderRequest ? { format: renderRequest.format } : {}),
        errorCode: toRenderError(error).body.error.code,
      });
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

function sendJsonError(res: ServerResponse, error: unknown) {
  const { statusCode, body } = toRenderError(error);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigin: string) {
  const origin = req.headers.origin;
  const resolvedOrigin = resolveAllowedOrigin(origin, allowedOrigin);

  if (resolvedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', resolvedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function resolveAllowedOrigin(origin: string | undefined, allowedOrigin: string): string | undefined {
  if (allowedOrigin === '*') return '*';
  if (!origin) return undefined;

  const allowedOrigins = allowedOrigin.split(',').map(value => value.trim()).filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : undefined;
}