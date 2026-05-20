import { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { RenderHttpError, toRenderError } from './lib/errors.js';
import { DEFAULT_OBSERVABILITY_CONFIG } from './observability/config.js';
import { withObservability } from './observability/middleware.js';
import { createObservabilitySink } from './observability/sink.js';
import { ObservabilityConfig, ObservabilitySink } from './observability/types.js';
import { createIntakeRoute, IntakeRouteOptions } from './routes/intake.js';
import { createObservabilityRoute } from './routes/observability.js';
import { createRenderTypstRoute, RenderTypstRouteOptions } from './routes/renderTypst.js';
import { createTailoringRoute, TailoringRouteOptions } from './routes/tailoring.js';

export type RenderApp = ((req: IncomingMessage, res: ServerResponse) => Promise<void> | void) & {
  close: () => Promise<void>;
};

export type RenderServerOptions = RenderTypstRouteOptions & IntakeRouteOptions & TailoringRouteOptions & {
  observabilityConfig?: ObservabilityConfig;
  observabilitySink?: ObservabilitySink;
  staticDir?: string;
};

export function createApp(options: RenderServerOptions = {}): RenderApp {
  const renderTypstRoute = createRenderTypstRoute(options);
  const intakeRoute = createIntakeRoute(options);
  const tailoringRoute = createTailoringRoute(options);
  const staticRoot = options.staticDir ? resolve(options.staticDir) : undefined;
  const observabilityConfig = options.observabilityConfig
    || (options.observabilitySink
      ? { ...DEFAULT_OBSERVABILITY_CONFIG, enabled: true }
      : DEFAULT_OBSERVABILITY_CONFIG);
  const observabilitySink = options.observabilitySink || createObservabilitySink(observabilityConfig);
  const observabilityRoute = createObservabilityRoute({
    observabilityConfig,
    allowedOrigin: options.allowedOrigin,
    diagnosticsProvider: () => observabilitySink.getDiagnostics?.(),
  });

  const app = async function app(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/api/render/typst') {
      await renderTypstRoute(req, res);
      return;
    }

    if (url.pathname.startsWith('/api/observability/')) {
      if (observabilityRoute) {
        await observabilityRoute(req, res, url);
        return;
      }
    }

    if (url.pathname.startsWith('/api/intake/')) {
      await intakeRoute(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/api/tailor/')) {
      await tailoringRoute(req, res, url);
      return;
    }

    if (staticRoot && (req.method === 'GET' || req.method === 'HEAD')) {
      const decodedPathname = decodeURIComponent(url.pathname);
      const requestedPath = normalize(decodedPathname).replace(/^(\.\.(\/|\\|$))+/, '');
      const candidatePath = resolve(join(staticRoot, requestedPath));
      const relativePath = relative(staticRoot, candidatePath);
      const isInsideStaticRoot = relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
      const filePath = isInsideStaticRoot && existsSync(candidatePath) && statSync(candidatePath).isFile()
        ? candidatePath
        : join(staticRoot, 'index.html');

      if (existsSync(filePath)) {
        serveStaticFile(res, filePath, staticRoot, req.method === 'HEAD');
        return;
      }
    }

    const { statusCode, body } = toRenderError(new RenderHttpError(404, 'NOT_FOUND', 'Route not found.'));
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  const observedApp = withObservability(app, { config: observabilityConfig, sink: observabilitySink }) as RenderApp;
  observedApp.close = async () => {
    await Promise.resolve(observabilitySink.close?.());
    observabilityRoute?.close?.();
    options.intakeUsageStore?.close?.();
    options.tailoringUsageStore?.close?.();
  };

  return observedApp;
}

function serveStaticFile(res: ServerResponse, filePath: string, staticRoot: string | undefined, headOnly = false) {
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Cache-Control', getStaticCacheControl(filePath, staticRoot));
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function getStaticCacheControl(filePath: string, staticRoot: string | undefined): string {
  if (filePath.endsWith('index.html')) {
    return 'no-cache';
  }

  const relativePath = staticRoot ? relative(staticRoot, filePath).replaceAll('\\', '/') : filePath.replaceAll('\\', '/');
  return isFingerprintedStaticAsset(relativePath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300';
}

function isFingerprintedStaticAsset(relativePath: string): boolean {
  return /^assets\/.+-[A-Za-z0-9_-]{8,}\.[^./]+$/i.test(relativePath);
}

function getContentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
