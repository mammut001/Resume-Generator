import { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RenderHttpError, toRenderError } from '../lib/errors.js';
import { hashIp, resolveClientIp } from '../observability/ip.js';

const ANALYTICS_EVENT_ALLOWLIST = new Set<string>([
  'page_viewed',
  'onboarding_viewed',
  'onboarding_dismissed',
  'start_action_clicked',
  'intake_started',
  'intake_completed',
  'intake_failed',
  'pdf_packet_blocked',
  'pdf_page_range_selected',
  'tailoring_started',
  'tailoring_completed',
  'tailoring_change_rejected',
  'tailoring_applied',
  'document_created',
  'document_duplicated',
  'document_deleted',
  'export_tab_viewed',
  'export_started',
  'export_completed',
  'export_failed',
]);

const SENSITIVE_KEY_PATTERN = /(resume|job|description|text|content|raw|model|name|email|phone|url|link|address)/i;

const ANALYTICS_MAX_BODY_BYTES = 16 * 1024;
const ANALYTICS_DEFAULT_RATE_PER_MIN = 240;
const ANALYTICS_RATE_WINDOW_MS = 60_1000;
const ANALYTICS_PAYLOAD_VALUE_LIMIT = 80;
const ANALYTICS_PAYLOAD_ARRAY_LIMIT = 20;
const ANALYTICS_PAYLOAD_KEY_LIMIT = 32;

export type AnalyticsRoute = ((req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>) & {
  close?: () => void;
};

export type AnalyticsRouteOptions = {
  allowedOrigin?: string;
  databasePath?: string;
  hmacSecret?: string;
  trustProxy?: boolean;
  isAuthorized?: (token: string | undefined) => boolean;
  rateLimitPerMinute?: number;
  now?: () => number;
};

export type AnalyticsEventRow = { event: string; occurredAt: string; route: string; ipHash: string | null };

export type AnalyticsSummary = {
  enabled: boolean;
  reason?: string;
  totalEvents: number;
  uniqueEvents: number;
  windows: {
    last24h: AnalyticsWindowSummary;
    last7d: AnalyticsWindowSummary;
    last30d: AnalyticsWindowSummary;
  };
  topEvents: Array<{ event: string; count: number }>;
  topRoutes: Array<{ route: string; count: number }>;
};

export type AnalyticsWindowSummary = { count: number; uniqueVisitors: number };

export function createAnalyticsRoute(options: AnalyticsRouteOptions = {}): AnalyticsRoute {
  const now = options.now || Date.now;
  const store: AnalyticsStore = options.databasePath
    ? createSqliteAnalyticsStore(options.databasePath, now)
    : createMemoryAnalyticsStore(now);
  const rateLimit = options.rateLimitPerMinute ?? ANALYTICS_DEFAULT_RATE_PER_MIN;
  const counters = new Map<string, { count: number; windowStartedAt: number }>();
  const trustProxy = options.trustProxy ?? false;
  const hmacSecret = options.hmacSecret || (process.env.NODE_ENV === 'production' ? '' : 'analytics-dev-only');

  function consume(identifier: string | null): boolean {
    if (!identifier) return true;
    const currentTime = now();
    const bucket = counters.get(identifier);
    if (!bucket || currentTime - bucket.windowStartedAt > ANALYTICS_RATE_WINDOW_MS) {
      counters.set(identifier, { count: 1, windowStartedAt: currentTime });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= rateLimit;
  }

  const analyticsRoute = async function analyticsRoute(req: IncomingMessage, res: ServerResponse, url: URL) {
    setCorsHeaders(req, res, options.allowedOrigin ?? '*');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.pathname === '/api/analytics/event') {
      if (req.method !== 'POST') {
        throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }

      const ip = resolveClientIp(req, trustProxy);
      if (!consume(ip)) {
        throw new RenderHttpError(429, 'QUOTA_EXCEEDED', 'Too many analytics events.');
      }

      const body = await readJsonBody(req, ANALYTICS_MAX_BODY_BYTES);
      const { event, payload, occurredAt } = sanitizeAnalyticsEventBody(body);
      const safePayload = sanitizePayload(payload);
      store.recordEvent({
        event,
        occurredAt: occurredAt || new Date(now()).toISOString(),
        payload: safePayload,
        route: url.pathname,
        ipHash: ip && hmacSecret ? hashIp(ip, hmacSecret) : null,
      });
      sendJson(res, 202, { accepted: true, event });
      return;
    }

    if (url.pathname === '/api/analytics/summary') {
      if (req.method !== 'GET') {
        throw new RenderHttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? undefined;
      if (!options.isAuthorized || !options.isAuthorized(auth)) {
        throw new RenderHttpError(401, 'UNAUTHORIZED', 'Unauthorized.');
      }
      sendJson(res, 200, store.getSummary(now()));
      return;
    }

    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Analytics route not found.' } });
  };

  analyticsRoute.close = store.close;
  return analyticsRoute;
}

function sanitizeAnalyticsEventBody(body: unknown): { event: string; payload: Record<string, unknown>; occurredAt: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Analytics event body must be an object.');
  }
  const record = body as Record<string, unknown>;
  const event = typeof record.event === 'string' ? record.event : '';
  if (!ANALYTICS_EVENT_ALLOWLIST.has(event)) {
    throw new RenderHttpError(400, 'VALIDATION_ERROR', 'Unsupported analytics event name.');
  }
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : {};
  const occurredAt = typeof record.occurredAt === 'string' ? record.occurredAt : null;
  return { event, payload, occurredAt };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = Object.keys(payload).slice(0, ANALYTICS_PAYLOAD_KEY_LIMIT);
  for (const key of keys) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const value = payload[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.slice(0, ANALYTICS_PAYLOAD_ARRAY_LIMIT);
    } else if (typeof value === 'string') {
      result[key] = value.slice(0, ANALYTICS_PAYLOAD_VALUE_LIMIT);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      result[key] = value;
    }
  }
  return result;
}

type AnalyticsStore = {
  recordEvent: (row: { event: string; occurredAt: string; payload: Record<string, unknown>; route: string; ipHash: string | null }) => void;
  getSummary: (nowMs: number) => AnalyticsSummary;
  close?: () => void;
  mode: 'sqlite' | 'memory';
};

function createMemoryAnalyticsStore(nowFn: () => number): AnalyticsStore {
  const events: AnalyticsEventRow[] = [];
  return {
    mode: 'memory',
    recordEvent: row => events.push({ event: row.event, occurredAt: row.occurredAt, route: row.route, ipHash: row.ipHash }),
    getSummary: nowMs => {
      const reasons = ['Analytics is using the in-memory store. Configure RESUME_ANALYTICS_SQLITE_PATH to persist events across restarts.'];
      return {
        enabled: false,
        reason: reasons[0],
        ...computeSummary(events, nowMs),
      };
    },
  };
}

function createSqliteAnalyticsStore(databasePath: string, nowFn: () => number): AnalyticsStore {
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  initializeAnalyticsSqliteSchema(db);
  const insertEvent = db.prepare(`
    insert into analytics_events (occurred_at, event_name, payload_json, route, ip_hash)
    values (?, ?, ?, ?, ?)
  `);
  return {
    mode: 'sqlite',
    recordEvent: ({ event, occurredAt, payload, route, ipHash }) => {
      insertEvent.run(occurredAt, event, JSON.stringify(payload), route, ipHash);
    },
    getSummary: nowMs => {
      const totalRow = db.prepare('select count(*) as count from analytics_events').get() as { count: number };
      const uniqueRow = db.prepare('select count(distinct event_name) as count from analytics_events').get() as { count: number };
      return {
        enabled: true,
        totalEvents: totalRow.count,
        uniqueEvents: uniqueRow.count,
        windows: {
          last24h: windowFromDb(db, new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()),
          last7d: windowFromDb(db, new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()),
          last30d: windowFromDb(db, new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString()),
        },
        topEvents: db.prepare(`
          select event_name as event, count(*) as count from analytics_events
          where occurred_at >= ? group by event_name order by count desc limit 10
        `).all(new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()) as Array<{ event: string; count: number }>,
        topRoutes: db.prepare(`
          select route, count(*) as count from analytics_events
          where occurred_at >= ? group by route order by count desc limit 10
        `).all(new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()) as Array<{ route: string; count: number }>,
      };
    },
    close: () => db.close(),
  };
}

function windowFromDb(db: DatabaseSync, sinceIso: string): AnalyticsWindowSummary {
  const row = db.prepare(`
    select count(*) as count,
           count(distinct coalesce(nullif(ip_hash, ''), event_name)) as uniqueVisitors
    from analytics_events where occurred_at >= ?
  `).get(sinceIso) as { count: number; uniqueVisitors: number };
  return { count: row.count, uniqueVisitors: row.uniqueVisitors };
}

function computeSummary(events: AnalyticsEventRow[], nowMs: number) {
  const within = (since: number) => events.filter(e => Date.parse(e.occurredAt) >= since);
  const last24h = within(nowMs - 24 * 60 * 60 * 1000);
  const last7d = within(nowMs - 7 * 24 * 60 * 60 * 1000);
  const last30d = within(nowMs - 30 * 24 * 60 * 60 * 1000);
  const tallyBy = <K extends 'event' | 'route'>(arr: AnalyticsEventRow[], key: K) => {
    const counts = new Map<string, number>();
    for (const e of arr) {
      const value = e[key];
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, count]) => ({ [key]: k, count }) as { event: string; count: number } | { route: string; count: number });
  };
  const uniqueVisitors = (arr: AnalyticsEventRow[]) => new Set(arr.map(e => e.ipHash ?? e.event)).size;
  return {
    totalEvents: events.length,
    uniqueEvents: new Set(events.map(e => e.event)).size,
    windows: {
      last24h: { count: last24h.length, uniqueVisitors: uniqueVisitors(last24h) },
      last7d: { count: last7d.length, uniqueVisitors: uniqueVisitors(last7d) },
      last30d: { count: last30d.length, uniqueVisitors: uniqueVisitors(last30d) },
    },
    topEvents: tallyBy(last7d, 'event') as Array<{ event: string; count: number }>,
    topRoutes: tallyBy(last7d, 'route') as Array<{ route: string; count: number }>,
  };
}

function initializeAnalyticsSqliteSchema(db: DatabaseSync) {
  db.exec(`
    create table if not exists analytics_events (
      id integer primary key,
      occurred_at text not null,
      event_name text not null,
      payload_json text not null,
      route text not null,
      ip_hash text
    );
    create index if not exists idx_analytics_events_name_time
      on analytics_events(event_name, occurred_at);
    create index if not exists idx_analytics_events_time
      on analytics_events(occurred_at);
    create index if not exists idx_analytics_events_route_time
      on analytics_events(route, occurred_at);
  `);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, allowedOrigin: string) {
  const origin = req.headers.origin;
  const resolvedOrigin = resolveAllowedOrigin(origin, allowedOrigin);
  if (resolvedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', resolvedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

function resolveAllowedOrigin(origin: string | undefined, allowedOrigin: string): string | undefined {
  if (allowedOrigin === '*') return '*';
  if (!origin) return undefined;
  const allowed = allowedOrigin.split(',').map(v => v.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : undefined;
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

export function toAnalyticsRouteError(error: unknown): { statusCode: number; body: RenderErrorBody } {
  return toRenderError(error);
}
import { RenderErrorBody } from '../lib/errors.js';
