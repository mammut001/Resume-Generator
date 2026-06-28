import { createServer } from 'node:http';
import { createApp } from './app.js';
import { DEFAULT_MAX_BODY_BYTES, DEFAULT_RENDER_TIMEOUT_MS, parseBooleanEnv, parsePositiveIntegerEnv } from './lib/validation.js';
import { createSqliteUsageStore } from './intake/usageStore.js';
import { resolveObservabilityConfigFromEnv } from './observability/config.js';
import {
  DEFAULT_PDF_OCR_IMAGE_WIDTH,
  DEFAULT_PDF_OCR_LANGUAGE,
  DEFAULT_PDF_OCR_LOW_CONFIDENCE_THRESHOLD,
  DEFAULT_PDF_OCR_MAX_PAGES,
} from './intake/pdfOcr.js';
import { DEFAULT_INTAKE_ATTEMPT_LIMIT, DEFAULT_INTAKE_MAX_BODY_BYTES, DEFAULT_INTAKE_MAX_PDF_BYTES, DEFAULT_INTAKE_MAX_TEXT_CHARS } from './routes/intake.js';
import { DEFAULT_TAILORING_ATTEMPT_LIMIT, DEFAULT_TAILORING_MAX_BODY_BYTES, DEFAULT_TAILORING_MAX_JOB_DESCRIPTION_CHARS } from './routes/tailoring.js';

try {
  process.loadEnvFile?.();
} catch {
  // `.env` is optional; deployed environments usually inject variables directly.
}

const port = parsePositiveIntegerEnv(process.env.PORT || process.env.TYPST_RENDER_PORT, 8787);
const host = process.env.HOST || '0.0.0.0';
const intakeAttemptLimit = parsePositiveIntegerEnv(process.env.RESUME_INTAKE_ATTEMPT_LIMIT, DEFAULT_INTAKE_ATTEMPT_LIMIT);
const tailoringAttemptLimit = parsePositiveIntegerEnv(process.env.RESUME_TAILORING_ATTEMPT_LIMIT, DEFAULT_TAILORING_ATTEMPT_LIMIT);
const aiUsageSqlitePath = process.env.RESUME_AI_USAGE_SQLITE_PATH?.trim() || process.env.RESUME_OBSERVABILITY_SQLITE_PATH?.trim();
const aiUsageHmacSecret = process.env.RESUME_AI_USAGE_HMAC_SECRET?.trim() || process.env.RESUME_OBSERVABILITY_HMAC_SECRET?.trim();
const aiUsageTrustProxy = parseBooleanEnv(
  process.env.RESUME_AI_USAGE_TRUST_PROXY,
  parseBooleanEnv(process.env.RESUME_OBSERVABILITY_TRUST_PROXY, false),
);
const aiUsageWindowMinutes = parsePositiveIntegerEnv(process.env.RESUME_AI_USAGE_WINDOW_MINUTES, 60);

if ((aiUsageSqlitePath && !aiUsageHmacSecret) || (!aiUsageSqlitePath && aiUsageHmacSecret)) {
  throw new Error('RESUME_AI_USAGE_SQLITE_PATH and RESUME_AI_USAGE_HMAC_SECRET must be configured together.');
}

const analyticsSqlitePath = process.env.RESUME_ANALYTICS_SQLITE_PATH?.trim();
const analyticsHmacSecret = process.env.RESUME_ANALYTICS_HMAC_SECRET?.trim();
const analyticsTrustProxy = parseBooleanEnv(
  process.env.RESUME_ANALYTICS_TRUST_PROXY,
  aiUsageTrustProxy,
);

if (process.env.NODE_ENV === 'production' && (!aiUsageSqlitePath || !aiUsageHmacSecret)) {
  throw new Error('Production requires RESUME_AI_USAGE_SQLITE_PATH and RESUME_AI_USAGE_HMAC_SECRET.');
}

if (process.env.NODE_ENV === 'production' && analyticsSqlitePath && !analyticsHmacSecret) {
  throw new Error('Production requires RESUME_ANALYTICS_HMAC_SECRET when RESUME_ANALYTICS_SQLITE_PATH is set.');
}

const allowedOrigin = process.env.TYPST_RENDER_ALLOWED_ORIGIN?.trim()
  || (process.env.NODE_ENV === 'production' ? '' : '*');

const intakeUsageStore = aiUsageSqlitePath && aiUsageHmacSecret
  ? createSqliteUsageStore({
    databasePath: aiUsageSqlitePath,
    scope: 'intake',
    limit: intakeAttemptLimit,
    windowMs: aiUsageWindowMinutes * 60_000,
    hmacSecret: aiUsageHmacSecret,
    trustProxy: aiUsageTrustProxy,
  })
  : undefined;

const tailoringUsageStore = aiUsageSqlitePath && aiUsageHmacSecret
  ? createSqliteUsageStore({
    databasePath: aiUsageSqlitePath,
    scope: 'tailoring',
    limit: tailoringAttemptLimit,
    windowMs: aiUsageWindowMinutes * 60_000,
    hmacSecret: aiUsageHmacSecret,
    trustProxy: aiUsageTrustProxy,
  })
  : undefined;

const app = createApp({
  typstBin: process.env.TYPST_BIN,
  timeoutMs: parsePositiveIntegerEnv(process.env.TYPST_RENDER_TIMEOUT_MS, DEFAULT_RENDER_TIMEOUT_MS),
  maxBodyBytes: parsePositiveIntegerEnv(process.env.TYPST_RENDER_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
  intakeAttemptLimit,
  intakeMaxBodyBytes: parsePositiveIntegerEnv(process.env.RESUME_INTAKE_MAX_BODY_BYTES, DEFAULT_INTAKE_MAX_BODY_BYTES),
  intakeMaxTextChars: parsePositiveIntegerEnv(process.env.RESUME_INTAKE_MAX_TEXT_CHARS, DEFAULT_INTAKE_MAX_TEXT_CHARS),
  intakeMaxPdfBytes: parsePositiveIntegerEnv(process.env.RESUME_INTAKE_MAX_PDF_BYTES, DEFAULT_INTAKE_MAX_PDF_BYTES),
  tailoringAttemptLimit,
  tailoringMaxBodyBytes: parsePositiveIntegerEnv(process.env.RESUME_TAILORING_MAX_BODY_BYTES, DEFAULT_TAILORING_MAX_BODY_BYTES),
  tailoringMaxJobDescriptionChars: parsePositiveIntegerEnv(process.env.RESUME_TAILORING_MAX_JOB_DESCRIPTION_CHARS, DEFAULT_TAILORING_MAX_JOB_DESCRIPTION_CHARS),
  ...(intakeUsageStore ? { intakeUsageStore } : {}),
  ...(tailoringUsageStore ? { tailoringUsageStore } : {}),
  pdfOcrConfig: {
    enabled: parseBooleanEnv(process.env.RESUME_INTAKE_PDF_OCR_ENABLED, false),
    language: process.env.RESUME_INTAKE_PDF_OCR_LANGUAGE || DEFAULT_PDF_OCR_LANGUAGE,
    maxPages: parsePositiveIntegerEnv(process.env.RESUME_INTAKE_PDF_OCR_MAX_PAGES, DEFAULT_PDF_OCR_MAX_PAGES),
    imageWidth: parsePositiveIntegerEnv(process.env.RESUME_INTAKE_PDF_OCR_IMAGE_WIDTH, DEFAULT_PDF_OCR_IMAGE_WIDTH),
    lowConfidenceThreshold: parsePositiveIntegerEnv(
      process.env.RESUME_INTAKE_PDF_OCR_LOW_CONFIDENCE_THRESHOLD,
      DEFAULT_PDF_OCR_LOW_CONFIDENCE_THRESHOLD,
    ),
  },
  modelGatewayConfig: {
    baseUrl: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    timeoutMs: parsePositiveIntegerEnv(process.env.OPENAI_TIMEOUT_MS, 60_000),
  },
  allowedOrigin,
  trustProxy: aiUsageTrustProxy,
  renderRateLimitPerMinute: parsePositiveIntegerEnv(process.env.TYPST_RENDER_RATE_LIMIT_PER_MINUTE, 120),
  analyticsOptions: {
    allowedOrigin,
    ...(analyticsSqlitePath ? { databasePath: analyticsSqlitePath } : {}),
    hmacSecret: analyticsHmacSecret || (process.env.NODE_ENV === 'production' ? undefined : 'analytics-dev-only'),
    trustProxy: analyticsTrustProxy,
    isAuthorized: token => Boolean(process.env.RESUME_ANALYTICS_SUMMARY_TOKEN && token === process.env.RESUME_ANALYTICS_SUMMARY_TOKEN),
  },
  observabilityConfig: resolveObservabilityConfigFromEnv(process.env),
  staticDir: process.env.RESUME_STATIC_DIR,
});

const server = createServer(app);

server.listen(port, host, () => {
  console.log(`Typst render server listening on http://${host}:${port}`);
});

async function shutdown() {
  try {
    await app.close();
  } finally {
    server.close(() => process.exit(0));
  }
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
