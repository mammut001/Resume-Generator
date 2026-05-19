import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DomainEvent, ObservabilitySink, RequestObservation } from './types.js';

export function createSqliteObservabilitySink(databasePath: string): ObservabilitySink {
  ensureObservabilityParentDirectory(databasePath);

  const db = new DatabaseSync(databasePath);
  initializeObservabilitySqliteSchema(db);

  const insertRequestStatement = db.prepare(`
    insert into request_observations (
      occurred_at,
      request_id,
      route_id,
      method,
      status_code,
      duration_ms,
      request_bytes,
      response_bytes,
      origin,
      content_type,
      ip_hash,
      network_hash,
      user_agent_family,
      error_code
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEventStatement = db.prepare(`
    insert into domain_events (
      occurred_at,
      request_id,
      route_id,
      event_name,
      payload_json
    ) values (?, ?, ?, ?, ?)
  `);

  return {
    recordRequest: observation => {
      insertRequestStatement.run(
        observation.occurredAt,
        observation.requestId,
        observation.routeId,
        observation.method,
        observation.statusCode,
        observation.durationMs,
        observation.requestBytes,
        observation.responseBytes,
        observation.origin,
        observation.contentType,
        observation.ipHash,
        observation.networkHash,
        observation.userAgentFamily,
        observation.errorCode,
      );
    },
    recordEvent: event => {
      insertEventStatement.run(
        event.occurredAt,
        event.requestId,
        event.routeId,
        event.eventName,
        JSON.stringify(event.payload),
      );
    },
    close: () => {
      db.close();
    },
  };
}

export function ensureObservabilityParentDirectory(databasePath: string) {
  if (databasePath === ':memory:') return;
  if (databasePath.startsWith('file:')) return;

  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

export function initializeObservabilitySqliteSchema(db: DatabaseSync) {
  db.exec(`
    create table if not exists request_observations (
      id integer primary key,
      occurred_at text not null,
      request_id text not null,
      route_id text not null,
      method text not null,
      status_code integer not null,
      duration_ms integer not null,
      request_bytes integer,
      response_bytes integer,
      origin text,
      content_type text,
      ip_hash text,
      network_hash text,
      user_agent_family text,
      error_code text
    );

    create table if not exists domain_events (
      id integer primary key,
      occurred_at text not null,
      request_id text not null,
      route_id text not null,
      event_name text not null,
      payload_json text not null
    );

    create table if not exists otlp_diagnostic_samples (
      id integer primary key,
      occurred_at text not null,
      queue_depth integer not null,
      queue_capacity integer not null,
      drop_policy text not null,
      in_flight integer not null,
      successful_exports integer not null,
      failed_exports integer not null,
      exported_log_records integer not null,
      dropped_log_records integer not null,
      dropped_overflow_log_records integer not null,
      dropped_failed_export_log_records integer not null,
      retry_count integer not null,
      last_error_at text,
      last_success_at text
    );

    create table if not exists observability_admin_tokens (
      id integer primary key check (id = 1),
      token_sha256 text not null,
      updated_at text not null
    );

    create index if not exists idx_request_observations_route_time
      on request_observations(route_id, occurred_at);

    create index if not exists idx_request_observations_ip_time
      on request_observations(ip_hash, occurred_at);

    create index if not exists idx_domain_events_name_time
      on domain_events(event_name, occurred_at);

    create index if not exists idx_otlp_diagnostic_samples_time
      on otlp_diagnostic_samples(occurred_at);
  `);
}