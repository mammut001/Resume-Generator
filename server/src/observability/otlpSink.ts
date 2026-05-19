import { DatabaseSync } from 'node:sqlite';
import { ensureObservabilityParentDirectory, initializeObservabilitySqliteSchema } from './sqliteSink.js';
import {
  DomainEvent,
  ObservabilitySink,
  ObservabilityValue,
  OtlpDiagnosticHistorySample,
  OtlpDropPolicy,
  OtlpExportDiagnostics,
  RequestObservation,
} from './types.js';

export type OtlpFetch = typeof fetch;

export type OtlpHttpJsonSinkOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  debug?: boolean;
  timeoutMs?: number;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  sqlitePath?: string;
  maxQueueSize?: number;
  dropPolicy?: OtlpDropPolicy;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: OtlpFetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
};

type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } };

type OtlpAttribute = {
  key: string;
  value: OtlpAnyValue;
};

type OtlpLogRecord = {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityText: string;
  severityNumber: number;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
};

const DEFAULT_OTLP_TIMEOUT_MS = 10_000;
const DEFAULT_OTLP_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_OTLP_MAX_BATCH_SIZE = 50;
const DEFAULT_OTLP_MAX_QUEUE_SIZE = 1_000;
const DEFAULT_OTLP_DROP_POLICY: OtlpDropPolicy = 'oldest';
const DEFAULT_OTLP_MAX_RETRIES = 3;
const DEFAULT_OTLP_INITIAL_BACKOFF_MS = 500;
const DEFAULT_OTLP_MAX_BACKOFF_MS = 5_000;
const DEFAULT_OTLP_DIAGNOSTICS_PERSIST_INTERVAL_MS = 30_000;

class OtlpExportFailure extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { retryable: boolean; retryAfterMs?: number | null }) {
    super(message);
    this.name = 'OtlpExportFailure';
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function createOtlpHttpJsonObservabilitySink(options: OtlpHttpJsonSinkOptions): ObservabilitySink {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_OTLP_TIMEOUT_MS;
  const flushIntervalMs = options.flushIntervalMs || DEFAULT_OTLP_FLUSH_INTERVAL_MS;
  const maxBatchSize = options.maxBatchSize || DEFAULT_OTLP_MAX_BATCH_SIZE;
  const maxQueueSize = Math.max(1, options.maxQueueSize ?? DEFAULT_OTLP_MAX_QUEUE_SIZE);
  const dropPolicy = options.dropPolicy || DEFAULT_OTLP_DROP_POLICY;
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_OTLP_MAX_RETRIES);
  const initialBackoffMs = Math.max(0, options.initialBackoffMs ?? DEFAULT_OTLP_INITIAL_BACKOFF_MS);
  const maxBackoffMs = Math.max(initialBackoffMs, options.maxBackoffMs ?? DEFAULT_OTLP_MAX_BACKOFF_MS);
  const sleepImpl = options.sleepImpl || wait;
  const queue: OtlpLogRecord[] = [];
  const diagnosticsDb = createDiagnosticsDatabase(options.sqlitePath);
  const insertDiagnosticsSampleStatement = diagnosticsDb?.prepare(`
    insert into otlp_diagnostic_samples (
      occurred_at,
      queue_depth,
      queue_capacity,
      drop_policy,
      in_flight,
      successful_exports,
      failed_exports,
      exported_log_records,
      dropped_log_records,
      dropped_overflow_log_records,
      dropped_failed_export_log_records,
      retry_count,
      last_error_at,
      last_success_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const diagnostics: OtlpExportDiagnostics = {
    queueDepth: 0,
    queueCapacity: maxQueueSize,
    dropPolicy,
    inFlight: false,
    successfulExports: 0,
    failedExports: 0,
    exportedLogRecords: 0,
    droppedLogRecords: 0,
    droppedOverflowLogRecords: 0,
    droppedFailedExportLogRecords: 0,
    retryCount: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastSuccessAt: null,
  };
  let lastPersistedAtMs = 0;
  let lastPersistedSignature = '';
  let flushTimer: NodeJS.Timeout | undefined;
  let flushInFlight: Promise<void> | undefined;

  return {
    recordRequest: observation => {
      enqueue(mapRequestObservation(observation));
    },
    recordEvent: event => {
      enqueue(mapDomainEvent(event));
    },
    getDiagnostics: () => ({
      otlp: {
        ...getDiagnosticsSnapshot(),
      },
    }),
    close: async () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }

      while (queue.length > 0 || flushInFlight) {
        await flush();
        await flushInFlight;
      }

      persistDiagnosticsSample(true);
      diagnosticsDb?.close();
    },
  };

  function enqueue(logRecord: OtlpLogRecord) {
    if (queue.length >= maxQueueSize) {
      if (dropPolicy === 'oldest') {
        const droppedCount = queue.length - maxQueueSize + 1;
        queue.splice(0, droppedCount);
        recordOverflowDrops(droppedCount);
      } else {
        recordOverflowDrops(1);
        return;
      }
    }

    queue.push(logRecord);
    persistDiagnosticsSample();

    if (queue.length >= maxBatchSize) {
      scheduleFlush(0);
      return;
    }

    scheduleFlush(flushIntervalMs);
  }

  function scheduleFlush(delayMs: number) {
    if (flushTimer && delayMs === 0) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }

    if (flushTimer) return;

    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush();
    }, delayMs);
  }

  async function flush(): Promise<void> {
    if (flushInFlight || queue.length === 0) return;

    const batch = queue.splice(0, maxBatchSize);
    flushInFlight = exportBatchWithRetry(batch)
      .finally(() => {
        flushInFlight = undefined;
        if (queue.length > 0) {
          scheduleFlush(0);
        }
      });

    persistDiagnosticsSample();

    await flushInFlight;
  }

  async function exportBatchWithRetry(logRecords: OtlpLogRecord[]): Promise<void> {
    if (logRecords.length === 0) return;

    let retryAttempt = 0;

    while (true) {
      try {
        await sendBatch(logRecords);
        diagnostics.successfulExports += 1;
        diagnostics.exportedLogRecords += logRecords.length;
        diagnostics.lastSuccessAt = new Date().toISOString();
        persistDiagnosticsSample(true);
        return;
      } catch (error) {
        const failure = normalizeExportFailure(error);
        diagnostics.lastErrorAt = new Date().toISOString();
        diagnostics.lastErrorMessage = failure.message;

        if (!failure.retryable || retryAttempt >= maxRetries) {
          diagnostics.failedExports += 1;
          diagnostics.droppedLogRecords += logRecords.length;
          diagnostics.droppedFailedExportLogRecords += logRecords.length;
          persistDiagnosticsSample(true);

          if (options.debug) {
            console.warn('OTLP observability export dropped batch.', failure);
          }

          return;
        }

        retryAttempt += 1;
        diagnostics.retryCount += 1;
        persistDiagnosticsSample();

        const delayMs = failure.retryAfterMs ?? Math.min(maxBackoffMs, initialBackoffMs * (2 ** (retryAttempt - 1)));
        if (options.debug) {
          console.warn(`OTLP observability export retry ${retryAttempt}/${maxRetries} in ${delayMs}ms.`, failure);
        }

        await sleepImpl(delayMs);
      }
    }
  }

  async function sendBatch(logRecords: OtlpLogRecord[]): Promise<void> {
    if (logRecords.length === 0) return;

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      let response: Response;

      try {
        response = await fetchImpl(options.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
          body: JSON.stringify(buildRequestBody(logRecords, options)),
          signal: abortController.signal,
        });
      } catch (error) {
        throw normalizeTransportFailure(error);
      }

      if (!response.ok) {
        throw new OtlpExportFailure(`OTLP logs export failed with status ${response.status}.`, {
          retryable: isRetryableStatus(response.status),
          retryAfterMs: parseRetryAfterHeader(response.headers.get('Retry-After')),
        });
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function recordOverflowDrops(count: number) {
    diagnostics.droppedLogRecords += count;
    diagnostics.droppedOverflowLogRecords += count;
    persistDiagnosticsSample(true);

    if (options.debug) {
      console.warn(`OTLP observability queue dropped ${count} log record${count === 1 ? '' : 's'} due to ${dropPolicy} overflow policy.`);
    }
  }

  function getDiagnosticsSnapshot(): OtlpExportDiagnostics {
    return {
      ...diagnostics,
      queueDepth: queue.length,
      inFlight: Boolean(flushInFlight),
    };
  }

  function persistDiagnosticsSample(force = false) {
    if (!insertDiagnosticsSampleStatement) return;

    const snapshot = getDiagnosticsSnapshot();
    const occurredAt = new Date().toISOString();
    const persistedSample = toDiagnosticHistorySample(occurredAt, snapshot);
    const signature = JSON.stringify(persistedSample);
    const nowMs = Date.now();

    if (!force) {
      if (signature === lastPersistedSignature) {
        return;
      }

      if (nowMs - lastPersistedAtMs < DEFAULT_OTLP_DIAGNOSTICS_PERSIST_INTERVAL_MS) {
        return;
      }
    }

    insertDiagnosticsSampleStatement.run(
      persistedSample.occurredAt,
      persistedSample.queueDepth,
      persistedSample.queueCapacity,
      persistedSample.dropPolicy,
      persistedSample.inFlight ? 1 : 0,
      persistedSample.successfulExports,
      persistedSample.failedExports,
      persistedSample.exportedLogRecords,
      persistedSample.droppedLogRecords,
      persistedSample.droppedOverflowLogRecords,
      persistedSample.droppedFailedExportLogRecords,
      persistedSample.retryCount,
      snapshot.lastErrorAt,
      snapshot.lastSuccessAt,
    );

    lastPersistedAtMs = nowMs;
    lastPersistedSignature = signature;
  }
}

function createDiagnosticsDatabase(sqlitePath: string | undefined): DatabaseSync | undefined {
  if (!sqlitePath) return undefined;

  ensureObservabilityParentDirectory(sqlitePath);

  const db = new DatabaseSync(sqlitePath);
  initializeObservabilitySqliteSchema(db);
  return db;
}

function toDiagnosticHistorySample(occurredAt: string, snapshot: OtlpExportDiagnostics): OtlpDiagnosticHistorySample {
  return {
    occurredAt,
    queueDepth: snapshot.queueDepth,
    queueCapacity: snapshot.queueCapacity,
    dropPolicy: snapshot.dropPolicy,
    inFlight: snapshot.inFlight,
    successfulExports: snapshot.successfulExports,
    failedExports: snapshot.failedExports,
    exportedLogRecords: snapshot.exportedLogRecords,
    droppedLogRecords: snapshot.droppedLogRecords,
    droppedOverflowLogRecords: snapshot.droppedOverflowLogRecords,
    droppedFailedExportLogRecords: snapshot.droppedFailedExportLogRecords,
    retryCount: snapshot.retryCount,
  };
}

function normalizeExportFailure(error: unknown): OtlpExportFailure {
  if (error instanceof OtlpExportFailure) {
    return error;
  }

  if (error instanceof Error) {
    return new OtlpExportFailure(error.message, { retryable: true });
  }

  return new OtlpExportFailure('OTLP logs export failed for an unknown reason.', { retryable: true });
}

function normalizeTransportFailure(error: unknown): OtlpExportFailure {
  if (error instanceof OtlpExportFailure) {
    return error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new OtlpExportFailure('OTLP logs export timed out.', { retryable: true });
  }

  if (error instanceof Error) {
    return new OtlpExportFailure(error.message, { retryable: true });
  }

  return new OtlpExportFailure('OTLP logs export failed for an unknown transport reason.', { retryable: true });
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null;

  if (/^\d+$/.test(value.trim())) {
    return Math.max(0, Number.parseInt(value.trim(), 10) * 1_000);
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;

  return Math.max(0, timestamp - Date.now());
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, delayMs);
  });
}

function buildRequestBody(logRecords: OtlpLogRecord[], options: OtlpHttpJsonSinkOptions) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(options),
        },
        scopeLogs: [
          {
            scope: {
              name: 'resume-generator.observability',
              ...(options.serviceVersion ? { version: options.serviceVersion } : {}),
            },
            logRecords,
          },
        ],
      },
    ],
  };
}

function buildResourceAttributes(options: OtlpHttpJsonSinkOptions): OtlpAttribute[] {
  const attributes: OtlpAttribute[] = [
    { key: 'service.name', value: { stringValue: options.serviceName } },
    { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
    { key: 'telemetry.sdk.name', value: { stringValue: 'resume-generator.observability' } },
  ];

  if (options.serviceVersion) {
    attributes.push({ key: 'service.version', value: { stringValue: options.serviceVersion } });
  }

  if (options.deploymentEnvironment) {
    attributes.push({ key: 'deployment.environment', value: { stringValue: options.deploymentEnvironment } });
  }

  return attributes;
}

function mapRequestObservation(observation: RequestObservation): OtlpLogRecord {
  const severity = observation.statusCode >= 500
    ? { text: 'ERROR', number: 17 }
    : observation.statusCode >= 400
      ? { text: 'WARN', number: 13 }
      : { text: 'INFO', number: 9 };

  return {
    timeUnixNano: isoToUnixNano(observation.occurredAt),
    observedTimeUnixNano: nowUnixNano(),
    severityText: severity.text,
    severityNumber: severity.number,
    body: { stringValue: 'request_observation' },
    attributes: buildAttributes({
      'record.kind': 'request_observation',
      'request.id': observation.requestId,
      'route.id': observation.routeId,
      'http.method': observation.method,
      'http.status_code': observation.statusCode,
      'http.request_bytes': observation.requestBytes,
      'http.response_bytes': observation.responseBytes,
      'http.origin': observation.origin,
      'http.content_type': observation.contentType,
      'client.ip_hash': observation.ipHash,
      'client.network_hash': observation.networkHash,
      'client.user_agent_family': observation.userAgentFamily,
      'error.code': observation.errorCode,
      'duration.ms': observation.durationMs,
    }),
  };
}

function mapDomainEvent(event: DomainEvent): OtlpLogRecord {
  const severity = event.eventName.endsWith('failed')
    ? { text: 'ERROR', number: 17 }
    : event.eventName === 'validation_failed' || event.eventName === 'quota_exceeded'
      ? { text: 'WARN', number: 13 }
      : { text: 'INFO', number: 9 };

  return {
    timeUnixNano: isoToUnixNano(event.occurredAt),
    observedTimeUnixNano: nowUnixNano(),
    severityText: severity.text,
    severityNumber: severity.number,
    body: { stringValue: event.eventName },
    attributes: buildAttributes({
      'record.kind': 'domain_event',
      'request.id': event.requestId,
      'route.id': event.routeId,
      ...Object.fromEntries(Object.entries(event.payload).map(([key, value]) => [`event.${key}`, value])),
    }),
  };
}

function buildAttributes(values: Record<string, ObservabilityValue | undefined>): OtlpAttribute[] {
  return Object.entries(values)
    .flatMap(([key, value]) => {
      const mappedValue = mapAnyValue(value);
      return mappedValue ? [{ key, value: mappedValue }] : [];
    });
}

function mapAnyValue(value: ObservabilityValue | undefined): OtlpAnyValue | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: `${value}` }
      : { doubleValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .map(entry => mapAnyValue(entry as ObservabilityValue))
          .filter((entry): entry is OtlpAnyValue => Boolean(entry)),
      },
    };
  }

  return undefined;
}

function isoToUnixNano(value: string): string {
  return `${BigInt(new Date(value).getTime()) * 1_000_000n}`;
}

function nowUnixNano(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}