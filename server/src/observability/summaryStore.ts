import { DatabaseSync } from 'node:sqlite';
import { initializeObservabilitySqliteSchema } from './sqliteSink.js';
import { OtlpDiagnosticHistorySample, OtlpDiagnosticsSummary } from './types.js';

const MAX_OTLP_HISTORY_SAMPLES = 240;
const OBSERVABILITY_EXCLUDED_ROUTE_FILTER = "and route_id not in ('observability_summary', 'observability_admin_token')";

export type ObservabilitySummary = {
  generatedAt: string;
  windowHours: number;
  requests: {
    total: number;
    errorCount: number;
    errorRate: number;
    p95DurationMs: number | null;
    recentCounts: Array<{
      bucketStart: string;
      requestCount: number;
      errorCount: number;
    }>;
  };
  recentFailures: Array<{
    routeId: string;
    statusCode: number;
    errorCode: string | null;
    count: number;
    lastOccurredAt: string;
  }>;
  topRoutes: Array<{
    routeId: string;
    requestCount: number;
    errorCount: number;
    errorRate: number;
  }>;
  topIpHashes: Array<{
    ipHash: string;
    requestCount: number;
    errorCount: number;
  }>;
  eventCounts: Array<{
    eventName: string;
    count: number;
  }>;
  sinks?: {
    otlp?: Partial<OtlpDiagnosticsSummary>;
  };
};

export type ObservabilitySummaryStore = {
  getSummary: (windowHours: number) => ObservabilitySummary;
  close: () => void;
};

export function createObservabilitySummaryStore(databasePath: string): ObservabilitySummaryStore {
  const db = new DatabaseSync(databasePath);
  initializeObservabilitySqliteSchema(db);

  const totalRequestsStatement = db.prepare(`
    select
      count(*) as total,
      sum(case when status_code >= 400 then 1 else 0 end) as error_count
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
  `);

  const recentCountsStatement = db.prepare(`
    select
      substr(occurred_at, 1, 13) || ':00:00Z' as bucket_start,
      count(*) as request_count,
      sum(case when status_code >= 400 then 1 else 0 end) as error_count
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
    group by bucket_start
    order by bucket_start asc
  `);

  const p95DurationStatement = db.prepare(`
    select
      duration_ms
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
    order by duration_ms asc
    limit 1 offset ?
  `);

  const recentFailuresStatement = db.prepare(`
    select
      route_id,
      status_code,
      error_code,
      count(*) as count,
      max(occurred_at) as last_occurred_at
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
      and status_code >= 400
    group by route_id, status_code, error_code
    order by last_occurred_at desc, count desc, route_id asc, status_code asc
    limit 20
  `);

  const topRoutesStatement = db.prepare(`
    select
      route_id,
      count(*) as request_count,
      sum(case when status_code >= 400 then 1 else 0 end) as error_count,
      case
        when count(*) = 0 then 0
        else cast(sum(case when status_code >= 400 then 1 else 0 end) as real) / count(*)
      end as error_rate
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
    group by route_id
    order by request_count desc, route_id asc
    limit 10
  `);

  const topIpHashesStatement = db.prepare(`
    select
      ip_hash,
      count(*) as request_count,
      sum(case when status_code >= 400 then 1 else 0 end) as error_count
    from request_observations
    where occurred_at >= ?
      ${OBSERVABILITY_EXCLUDED_ROUTE_FILTER}
      and ip_hash is not null
    group by ip_hash
    order by request_count desc, ip_hash asc
    limit 10
  `);

  const eventCountsStatement = db.prepare(`
    select
      event_name,
      count(*) as count
    from domain_events
    where occurred_at >= ?
    group by event_name
    order by count desc, event_name asc
    limit 20
  `);

  const otlpHistoryStatement = db.prepare(`
    select
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
      retry_count
    from otlp_diagnostic_samples
    where occurred_at >= ?
    order by occurred_at desc
    limit ?
  `);

  return {
    getSummary: (windowHours: number) => {
      const threshold = new Date(Date.now() - (windowHours * 60 * 60 * 1_000)).toISOString();
      const totals = totalRequestsStatement.get(threshold) as { total: number; error_count: number | null };
      const total = Number(totals.total || 0);
      const errorCount = Number(totals.error_count || 0);
      const p95DurationRow = total > 0
        ? p95DurationStatement.get(threshold, Math.max(0, Math.ceil(total * 0.95) - 1)) as { duration_ms: number } | undefined
        : undefined;
      const otlpHistorySamples = (otlpHistoryStatement.all(threshold, MAX_OTLP_HISTORY_SAMPLES) as Array<{
        occurred_at: string;
        queue_depth: number;
        queue_capacity: number;
        drop_policy: OtlpDiagnosticHistorySample['dropPolicy'];
        in_flight: number;
        successful_exports: number;
        failed_exports: number;
        exported_log_records: number;
        dropped_log_records: number;
        dropped_overflow_log_records: number;
        dropped_failed_export_log_records: number;
        retry_count: number;
      }>).reverse().map(row => ({
        occurredAt: row.occurred_at,
        queueDepth: Number(row.queue_depth || 0),
        queueCapacity: Number(row.queue_capacity || 0),
        dropPolicy: row.drop_policy,
        inFlight: Boolean(row.in_flight),
        successfulExports: Number(row.successful_exports || 0),
        failedExports: Number(row.failed_exports || 0),
        exportedLogRecords: Number(row.exported_log_records || 0),
        droppedLogRecords: Number(row.dropped_log_records || 0),
        droppedOverflowLogRecords: Number(row.dropped_overflow_log_records || 0),
        droppedFailedExportLogRecords: Number(row.dropped_failed_export_log_records || 0),
        retryCount: Number(row.retry_count || 0),
      }));

      return {
        generatedAt: new Date().toISOString(),
        windowHours,
        requests: {
          total,
          errorCount,
          errorRate: total === 0 ? 0 : errorCount / total,
          p95DurationMs: p95DurationRow ? Number(p95DurationRow.duration_ms) : null,
          recentCounts: (recentCountsStatement.all(threshold) as Array<{
            bucket_start: string;
            request_count: number;
            error_count: number | null;
          }>).map(row => ({
            bucketStart: row.bucket_start,
            requestCount: Number(row.request_count || 0),
            errorCount: Number(row.error_count || 0),
          })),
        },
        recentFailures: (recentFailuresStatement.all(threshold) as Array<{
          route_id: string;
          status_code: number;
          error_code: string | null;
          count: number;
          last_occurred_at: string;
        }>).map(row => ({
          routeId: row.route_id,
          statusCode: Number(row.status_code || 0),
          errorCode: row.error_code,
          count: Number(row.count || 0),
          lastOccurredAt: row.last_occurred_at,
        })),
        topRoutes: (topRoutesStatement.all(threshold) as Array<{
          route_id: string;
          request_count: number;
          error_count: number | null;
          error_rate: number | null;
        }>).map(row => ({
          routeId: row.route_id,
          requestCount: Number(row.request_count || 0),
          errorCount: Number(row.error_count || 0),
          errorRate: Number(row.error_rate || 0),
        })),
        topIpHashes: (topIpHashesStatement.all(threshold) as Array<{
          ip_hash: string;
          request_count: number;
          error_count: number | null;
        }>).map(row => ({
          ipHash: row.ip_hash,
          requestCount: Number(row.request_count || 0),
          errorCount: Number(row.error_count || 0),
        })),
        eventCounts: (eventCountsStatement.all(threshold) as Array<{
          event_name: string;
          count: number;
        }>).map(row => ({
          eventName: row.event_name,
          count: Number(row.count || 0),
        })),
        ...(otlpHistorySamples.length > 0
          ? {
              sinks: {
                otlp: {
                  history: {
                    samples: otlpHistorySamples,
                  },
                },
              },
            }
          : {}),
      };
    },
    close: () => {
      db.close();
    },
  };
}
