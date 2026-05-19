import { IncomingMessage, ServerResponse } from 'node:http';
import { RenderHttpError, toRenderError } from '../lib/errors.js';
import { DEFAULT_MAX_BODY_BYTES } from '../lib/validation.js';
import { createObservabilityAdminTokenStore } from '../observability/adminTokenStore.js';
import { createObservabilitySummaryStore, ObservabilitySummary, ObservabilitySummaryStore } from '../observability/summaryStore.js';
import { ObservabilityConfig, ObservabilityDiagnostics } from '../observability/types.js';

const MAX_SUMMARY_WINDOW_HOURS = 24 * 7;

export type ObservabilityRouteOptions = {
  observabilityConfig: ObservabilityConfig;
  allowedOrigin?: string;
  summaryStore?: ObservabilitySummaryStore;
  diagnosticsProvider?: () => ObservabilityDiagnostics | undefined;
};

export function createObservabilityRoute(options: ObservabilityRouteOptions) {
  if (!options.observabilityConfig.summaryEnabled) {
    return undefined;
  }

  const summaryToken = options.observabilityConfig.summaryToken;
  const defaultWindowHours = options.observabilityConfig.summaryDefaultWindowHours || 24;
  const databasePath = resolveSummaryDatabasePath(options.observabilityConfig);
  const store = options.summaryStore || createObservabilitySummaryStore(databasePath);
  const adminTokenStore = createObservabilityAdminTokenStore(databasePath, summaryToken);

  const observabilityRoute = async function observabilityRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    setCorsHeaders(req, res, options.allowedOrigin ?? '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (url.pathname === '/api/observability/summary') {
        if (req.method !== 'GET') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        if (!adminTokenStore.isAuthorized(readBearerToken(req))) {
          throw new RenderHttpError(401, 'UNAUTHORIZED', 'Unauthorized.');
        }

        const windowHours = parseWindowHours(url.searchParams.get('hours'), defaultWindowHours);
        const summary = store.getSummary(windowHours);
        const diagnostics = options.diagnosticsProvider?.();
        sendJson(res, 200, mergeSummaryWithDiagnostics(summary, diagnostics));
        return;
      }

      if (url.pathname === '/api/observability/admin/token') {
        if (req.method !== 'POST') {
          throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        }

        const currentToken = readBearerToken(req);
        if (!adminTokenStore.isAuthorized(currentToken)) {
          throw new RenderHttpError(401, 'UNAUTHORIZED', 'Unauthorized.');
        }

        const payload = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES);
        const newToken = validateTokenRotationPayload(payload);
        if (currentToken?.trim() === newToken) {
          throw new RenderHttpError(400, 'VALIDATION_ERROR', 'New admin token must be different from the current token.');
        }

        const { updatedAt } = adminTokenStore.rotateToken(newToken);
        sendJson(res, 200, {
          success: true,
          tokenUpdatedAt: updatedAt,
        });
        return;
      }

      if (url.pathname.startsWith('/api/observability/')) {
        throw new RenderHttpError(404, 'NOT_FOUND', 'Observability route not found.');
      }
    } catch (error) {
      sendJsonError(res, error);
    }
  };

  return Object.assign(observabilityRoute, {
    close: () => {
      store.close();
      adminTokenStore.close();
    },
  });
}

function resolveSummaryDatabasePath(config: ObservabilityConfig): string {
  if (!config.sqlitePath || config.sqlitePath === ':memory:') {
    throw new RenderHttpError(503, 'OBSERVABILITY_UNAVAILABLE', 'Observability summary requires a file-backed sqlite database.');
  }

  return config.sqlitePath;
}

function readBearerToken(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  return authorization.slice('Bearer '.length).trim();
}

function parseWindowHours(value: string | null, fallback: number): number {
  if (!value) return fallback;

  if (!/^\d+$/.test(value)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'hours must be a positive integer.');
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SUMMARY_WINDOW_HOURS) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', `hours must be between 1 and ${MAX_SUMMARY_WINDOW_HOURS}.`);
  }

  return parsed;
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

function validateTokenRotationPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const payloadRecord = payload as Record<string, unknown>;
  const newToken = typeof payloadRecord.newToken === 'string' ? payloadRecord.newToken.trim() : '';
  if (newToken.length < 8 || newToken.length > 128) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'New admin token must be between 8 and 128 characters.');
  }

  if (/\s/.test(newToken)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'New admin token must not contain spaces.');
  }

  return newToken;
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigin: string) {
  const origin = req.headers.origin;
  const resolvedOrigin = resolveAllowedOrigin(origin, allowedOrigin);

  if (resolvedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', resolvedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

function resolveAllowedOrigin(origin: string | undefined, allowedOrigin: string): string | undefined {
  if (allowedOrigin === '*') return '*';
  if (!origin) return undefined;

  const allowedOrigins = allowedOrigin.split(',').map(value => value.trim()).filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : undefined;
}

function hasDiagnostics(diagnostics: ObservabilityDiagnostics | undefined): diagnostics is ObservabilityDiagnostics {
  return Boolean(diagnostics && Object.keys(diagnostics).length > 0);
}

function mergeSummaryWithDiagnostics(summary: ObservabilitySummary, diagnostics: ObservabilityDiagnostics | undefined): ObservabilitySummary {
  if (!hasDiagnostics(diagnostics)) {
    return summary;
  }

  return {
    ...summary,
    sinks: {
      ...summary.sinks,
      ...diagnostics,
      ...(summary.sinks?.otlp || diagnostics.otlp
        ? {
            otlp: {
              ...summary.sinks?.otlp,
              ...diagnostics.otlp,
            },
          }
        : {}),
    },
  };
}