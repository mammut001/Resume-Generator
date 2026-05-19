import { IncomingMessage, ServerResponse } from 'node:http';
import { hashIp, hashNetwork, resolveClientIp } from './ip.js';
import { createRequestId, setRequestContext } from './requestContext.js';
import { resolveRouteId } from './routeIds.js';
import { DomainEventPayload, ObservabilityConfig, ObservabilitySink } from './types.js';
import { resolveUserAgentFamily } from './userAgent.js';

const MAX_CAPTURED_ERROR_BYTES = 8 * 1024;

type AppHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

export function withObservability(
  handler: AppHandler,
  options: { config: ObservabilityConfig; sink: ObservabilitySink },
): AppHandler {
  if (!options.config.enabled) return handler;

  return async function observedHandler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const routeId = resolveRouteId(url.pathname);
    const requestId = createRequestId();
    const requestStartedAt = process.hrtime.bigint();
    const occurredAt = new Date().toISOString();
    const requestBytes = parseContentLength(req.headers['content-length']);
    const origin = readHeaderValue(req.headers.origin);
    const contentType = readHeaderValue(req.headers['content-type']);
    const clientIp = resolveClientIp(req, options.config.trustProxy);
    const ipHash = clientIp && options.config.hmacSecret ? hashIp(clientIp, options.config.hmacSecret) : null;
    const networkHash = clientIp && options.config.hmacSecret ? hashNetwork(clientIp, options.config.hmacSecret) : null;
    const userAgentFamily = resolveUserAgentFamily(req.headers['user-agent']);

    let responseBytes = 0;
    let capturedErrorBytes = 0;
    let finalized = false;
    const errorChunks: Buffer[] = [];

    setRequestContext(req, {
      requestId,
      routeId,
      recordEvent: (eventName: string, payload: DomainEventPayload = {}) => {
        recordSafely(() => options.sink.recordEvent({
          occurredAt: new Date().toISOString(),
          requestId,
          routeId,
          eventName,
          payload,
        }));
      },
    });

    res.setHeader('X-Request-Id', requestId);

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
      trackResponseChunk(chunk, typeof encoding === 'string' ? encoding : undefined);
      return originalWrite(chunk, encoding as BufferEncoding, callback);
    }) as typeof res.write;

    res.end = ((chunk?: string | Uint8Array, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
      if (chunk !== undefined) {
        trackResponseChunk(chunk, typeof encoding === 'string' ? encoding : undefined);
      }

      return originalEnd(chunk, encoding as BufferEncoding, callback);
    }) as typeof res.end;

    res.on('finish', () => {
      if (finalized) return;
      finalized = true;

      recordSafely(() => options.sink.recordRequest({
        occurredAt,
        requestId,
        routeId,
        method: req.method || 'GET',
        statusCode: res.statusCode,
        durationMs: Math.max(0, Math.round(Number(process.hrtime.bigint() - requestStartedAt) / 1_000_000)),
        requestBytes,
        responseBytes,
        origin,
        contentType,
        ipHash,
        networkHash,
        userAgentFamily,
        errorCode: extractErrorCode(res, errorChunks),
      }));
    });

    await handler(req, res);

    function trackResponseChunk(chunk: string | Uint8Array, encoding?: BufferEncoding) {
      const buffer = toBuffer(chunk, encoding);
      if (!buffer) return;

      responseBytes += buffer.length;

      if (!shouldCaptureErrorBody(res, capturedErrorBytes, buffer.length)) return;

      errorChunks.push(buffer);
      capturedErrorBytes += buffer.length;
    }
  };
}

function extractErrorCode(res: ServerResponse, errorChunks: Buffer[]): string | null {
  if (res.statusCode < 400 || errorChunks.length === 0) return null;

  const contentType = readHeaderValue(res.getHeader('Content-Type') || res.getHeader('content-type'));
  if (!contentType?.toLowerCase().startsWith('application/json')) return null;

  try {
    const payload = JSON.parse(Buffer.concat(errorChunks).toString('utf8')) as { error?: { code?: unknown } };
    return typeof payload.error?.code === 'string' ? payload.error.code : null;
  } catch {
    return null;
  }
}

function shouldCaptureErrorBody(res: ServerResponse, capturedBytes: number, nextChunkBytes: number): boolean {
  if (res.statusCode < 400) return false;

  const contentType = readHeaderValue(res.getHeader('Content-Type') || res.getHeader('content-type'));
  if (!contentType?.toLowerCase().startsWith('application/json')) return false;

  return capturedBytes + nextChunkBytes <= MAX_CAPTURED_ERROR_BYTES;
}

function parseContentLength(headerValue: string | string[] | undefined): number | null {
  const rawValue = readHeaderValue(headerValue);
  if (!rawValue) return null;

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readHeaderValue(value: string | string[] | number | undefined): string | null {
  if (typeof value === 'number') return `${value}`;
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function toBuffer(chunk: string | Uint8Array, encoding?: BufferEncoding): Buffer | null {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding || 'utf8');
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  return null;
}

function recordSafely(operation: () => void | Promise<void>) {
  try {
    const result = operation();
    if (isPromiseLike(result)) {
      void result.catch(() => undefined);
    }
  } catch {
    // Observability should never break the request path.
  }
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && 'catch' in value;
}