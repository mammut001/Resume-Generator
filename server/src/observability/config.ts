import { parseBooleanEnv, parsePositiveIntegerEnv } from '../lib/validation.js';
import { ObservabilityConfig } from './types.js';

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: false,
  sink: 'noop',
  trustProxy: false,
  debug: false,
  summaryEnabled: false,
  summaryDefaultWindowHours: 24,
  otlpServiceName: 'resume-generator-backend',
  otlpTimeoutMs: 10_000,
  otlpFlushIntervalMs: 1_000,
  otlpMaxBatchSize: 50,
  otlpMaxQueueSize: 1_000,
  otlpDropPolicy: 'oldest',
  otlpMaxRetries: 3,
  otlpInitialBackoffMs: 500,
  otlpMaxBackoffMs: 5_000,
};

export function resolveObservabilityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ObservabilityConfig {
  const enabled = parseBooleanEnv(env.RESUME_OBSERVABILITY_ENABLED, DEFAULT_OBSERVABILITY_CONFIG.enabled);
  const sink = parseSinkEnv(env.RESUME_OBSERVABILITY_SINK, enabled ? 'stdout-json' : DEFAULT_OBSERVABILITY_CONFIG.sink);
  const hmacSecret = env.RESUME_OBSERVABILITY_HMAC_SECRET?.trim();
  const sqlitePath = env.RESUME_OBSERVABILITY_SQLITE_PATH?.trim();
  const summaryEnabled = parseBooleanEnv(env.RESUME_OBSERVABILITY_SUMMARY_ENABLED, DEFAULT_OBSERVABILITY_CONFIG.summaryEnabled);
  const summaryToken = env.RESUME_OBSERVABILITY_SUMMARY_TOKEN?.trim();
  const otlpLogsEndpoint = env.RESUME_OBSERVABILITY_OTLP_LOGS_ENDPOINT?.trim();
  const otlpHeaders = parseJsonObjectEnv(env.RESUME_OBSERVABILITY_OTLP_HEADERS_JSON);

  if (enabled && !hmacSecret) {
    throw new Error('RESUME_OBSERVABILITY_HMAC_SECRET is required when RESUME_OBSERVABILITY_ENABLED=1.');
  }

  if (enabled && sink === 'sqlite' && !sqlitePath) {
    throw new Error('RESUME_OBSERVABILITY_SQLITE_PATH is required when RESUME_OBSERVABILITY_SINK=sqlite.');
  }

  if (!enabled && summaryEnabled) {
    throw new Error('RESUME_OBSERVABILITY_SUMMARY_ENABLED=1 requires RESUME_OBSERVABILITY_ENABLED=1.');
  }

  if (enabled && summaryEnabled) {
    if (sink !== 'sqlite' || !sqlitePath || sqlitePath === ':memory:') {
      throw new Error('Observability summary requires a file-backed sqlite sink.');
    }

    if (!summaryToken) {
      throw new Error('RESUME_OBSERVABILITY_SUMMARY_TOKEN is required when RESUME_OBSERVABILITY_SUMMARY_ENABLED=1.');
    }
  }

  return {
    enabled,
    sink,
    trustProxy: parseBooleanEnv(env.RESUME_OBSERVABILITY_TRUST_PROXY, DEFAULT_OBSERVABILITY_CONFIG.trustProxy),
    debug: parseBooleanEnv(env.RESUME_OBSERVABILITY_DEBUG, DEFAULT_OBSERVABILITY_CONFIG.debug),
    summaryEnabled,
    summaryDefaultWindowHours: parsePositiveIntegerEnv(
      env.RESUME_OBSERVABILITY_SUMMARY_DEFAULT_WINDOW_HOURS,
      DEFAULT_OBSERVABILITY_CONFIG.summaryDefaultWindowHours || 24,
    ),
    ...(summaryToken ? { summaryToken } : {}),
    ...(hmacSecret ? { hmacSecret } : {}),
    ...(sqlitePath ? { sqlitePath } : {}),
    ...(otlpLogsEndpoint ? { otlpLogsEndpoint } : {}),
    ...(otlpHeaders ? { otlpHeaders } : {}),
    otlpServiceName: env.RESUME_OBSERVABILITY_OTLP_SERVICE_NAME?.trim() || DEFAULT_OBSERVABILITY_CONFIG.otlpServiceName,
    ...(env.RESUME_OBSERVABILITY_OTLP_SERVICE_VERSION?.trim()
      ? { otlpServiceVersion: env.RESUME_OBSERVABILITY_OTLP_SERVICE_VERSION.trim() }
      : {}),
    ...(env.RESUME_OBSERVABILITY_OTLP_DEPLOYMENT_ENVIRONMENT?.trim()
      ? { otlpDeploymentEnvironment: env.RESUME_OBSERVABILITY_OTLP_DEPLOYMENT_ENVIRONMENT.trim() }
      : {}),
    otlpTimeoutMs: parsePositiveIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_TIMEOUT_MS,
      DEFAULT_OBSERVABILITY_CONFIG.otlpTimeoutMs || 10_000,
    ),
    otlpFlushIntervalMs: parsePositiveIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_FLUSH_INTERVAL_MS,
      DEFAULT_OBSERVABILITY_CONFIG.otlpFlushIntervalMs || 1_000,
    ),
    otlpMaxBatchSize: parsePositiveIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_MAX_BATCH_SIZE,
      DEFAULT_OBSERVABILITY_CONFIG.otlpMaxBatchSize || 50,
    ),
    otlpMaxQueueSize: parsePositiveIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_MAX_QUEUE_SIZE,
      DEFAULT_OBSERVABILITY_CONFIG.otlpMaxQueueSize || 1_000,
    ),
    otlpDropPolicy: parseOtlpDropPolicyEnv(
      env.RESUME_OBSERVABILITY_OTLP_DROP_POLICY,
      DEFAULT_OBSERVABILITY_CONFIG.otlpDropPolicy || 'oldest',
    ),
    otlpMaxRetries: parseNonNegativeIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_MAX_RETRIES,
      DEFAULT_OBSERVABILITY_CONFIG.otlpMaxRetries || 3,
    ),
    otlpInitialBackoffMs: parseNonNegativeIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_INITIAL_BACKOFF_MS,
      DEFAULT_OBSERVABILITY_CONFIG.otlpInitialBackoffMs || 500,
    ),
    otlpMaxBackoffMs: parseNonNegativeIntegerEnv(
      env.RESUME_OBSERVABILITY_OTLP_MAX_BACKOFF_MS,
      DEFAULT_OBSERVABILITY_CONFIG.otlpMaxBackoffMs || 5_000,
    ),
  };
}

function parseSinkEnv(value: string | undefined, fallback: ObservabilityConfig['sink']): ObservabilityConfig['sink'] {
  if (value === 'noop' || value === 'stdout-json' || value === 'sqlite') return value;
  return fallback;
}

function parseJsonObjectEnv(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('RESUME_OBSERVABILITY_OTLP_HEADERS_JSON must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RESUME_OBSERVABILITY_OTLP_HEADERS_JSON must be a JSON object.');
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, headerValue]) => typeof headerValue === 'string')
      .map(([headerName, headerValue]) => [headerName, headerValue]),
  );
}

function parseNonNegativeIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOtlpDropPolicyEnv(value: string | undefined, fallback: NonNullable<ObservabilityConfig['otlpDropPolicy']>): NonNullable<ObservabilityConfig['otlpDropPolicy']> {
  if (value === 'oldest' || value === 'newest') return value;
  return fallback;
}