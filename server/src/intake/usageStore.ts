import { IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { RenderHttpError } from '../lib/errors.js';
import { hashIp, resolveClientIp } from '../observability/ip.js';
import { ensureObservabilityParentDirectory } from '../observability/sqliteSink.js';
import { ResumeIntakeUsage } from './types.js';

export type QuotaReservation = {
  clientKey?: string;
  subjectHash?: string;
  windowStartedAt?: number;
};

export type IntakeUsageStore = {
  getUsage: (req?: IncomingMessage) => ResumeIntakeUsage;
  createReservation: (req?: IncomingMessage) => QuotaReservation;
  consumeAttempt: (req?: IncomingMessage) => ResumeIntakeUsage;
  refundAttempt: (req?: IncomingMessage, reservation?: QuotaReservation) => ResumeIntakeUsage;
  close?: () => void;
};

export type SqliteUsageStoreOptions = {
  databasePath: string;
  scope: 'intake' | 'tailoring';
  limit: number;
  windowMs: number;
  hmacSecret: string;
  trustProxy: boolean;
  now?: () => number;
};

export function createIntakeUsageStore(limit: number): IntakeUsageStore {
  const usageByClient = new Map<string, number>();

  const resolveClientKey = (req?: IncomingMessage): string => {
    const remoteAddress = req?.socket?.remoteAddress;
    return remoteAddress || 'unknown';
  };

  const readUsage = (req?: IncomingMessage): ResumeIntakeUsage => {
    const usedAttempts = usageByClient.get(resolveClientKey(req)) || 0;
    return {
      remainingAttempts: Math.max(limit - usedAttempts, 0),
      limit,
      resetAt: null,
    };
  };

  return {
    getUsage: req => readUsage(req),
    createReservation: req => ({ clientKey: resolveClientKey(req) }),
    consumeAttempt: req => {
      const clientKey = resolveClientKey(req);
      const usedAttempts = usageByClient.get(clientKey) || 0;

      if (usedAttempts >= limit) {
        throw new RenderHttpError(429, 'QUOTA_EXCEEDED', 'No intake attempts remaining.');
      }

      usageByClient.set(clientKey, usedAttempts + 1);
      return readUsage(req);
    },
    refundAttempt: (req, reservation) => {
      const clientKey = reservation?.clientKey || resolveClientKey(req);
      const usedAttempts = usageByClient.get(clientKey) || 0;
      if (usedAttempts > 0) {
        usageByClient.set(clientKey, usedAttempts - 1);
      }
      return readUsage(req);
    },
  };
}

export function createSqliteUsageStore(options: SqliteUsageStoreOptions): IntakeUsageStore {
  ensureObservabilityParentDirectory(options.databasePath);

  const db = new DatabaseSync(options.databasePath);
  initializeUsageSqliteSchema(db);

  const now = options.now || Date.now;
  const selectUsageStatement = db.prepare(`
    select used_count as usedCount
    from ai_usage_windows
    where scope = ? and subject_hash = ? and window_started_at = ?
  `);
  const insertUsageStatement = db.prepare(`
    insert into ai_usage_windows (
      scope,
      subject_hash,
      window_started_at,
      used_count,
      updated_at
    ) values (?, ?, ?, ?, ?)
  `);
  const updateUsageStatement = db.prepare(`
    update ai_usage_windows
    set used_count = ?, updated_at = ?
    where scope = ? and subject_hash = ? and window_started_at = ?
  `);
  const pruneUsageStatement = db.prepare(`
    delete from ai_usage_windows
    where scope = ? and window_started_at < ?
  `);

  const readUsage = (req?: IncomingMessage): ResumeIntakeUsage => {
    const currentTime = now();
    const windowStartedAt = resolveWindowStartedAt(currentTime, options.windowMs);
    const subjectHash = resolveSubjectHash(req, options.hmacSecret, options.trustProxy);
    const usageRow = selectUsageStatement.get(
      options.scope,
      subjectHash,
      windowStartedAt,
    ) as { usedCount: number } | undefined;

    return buildUsagePayload({
      limit: options.limit,
      usedAttempts: usageRow?.usedCount || 0,
      windowStartedAt,
      windowMs: options.windowMs,
    });
  };

  const consumeAttempt = (subjectHash: string, currentTime: number) => {
    const windowStartedAt = resolveWindowStartedAt(currentTime, options.windowMs);
    const updatedAt = new Date(currentTime).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      const usageRow = selectUsageStatement.get(
        options.scope,
        subjectHash,
        windowStartedAt,
      ) as { usedCount: number } | undefined;
      const usedAttempts = usageRow?.usedCount || 0;

      if (usedAttempts >= options.limit) {
        throw new RenderHttpError(429, 'QUOTA_EXCEEDED', 'No intake attempts remaining in the current window.');
      }

      if (usageRow) {
        updateUsageStatement.run(
          usedAttempts + 1,
          updatedAt,
          options.scope,
          subjectHash,
          windowStartedAt,
        );
      } else {
        insertUsageStatement.run(
          options.scope,
          subjectHash,
          windowStartedAt,
          1,
          updatedAt,
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after a failed transaction.
      }
      throw error;
    }

    pruneUsageStatement.run(options.scope, windowStartedAt - (options.windowMs * 24));

    const nextUsedAttempts = ((selectUsageStatement.get(
      options.scope,
      subjectHash,
      windowStartedAt,
    ) as { usedCount: number } | undefined)?.usedCount) || 0;

    return buildUsagePayload({
      limit: options.limit,
      usedAttempts: nextUsedAttempts,
      windowStartedAt,
      windowMs: options.windowMs,
    });
  };

  const refundAttempt = (subjectHash: string, windowStartedAt: number) => {
    const updatedAt = new Date(now()).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      const usageRow = selectUsageStatement.get(
        options.scope,
        subjectHash,
        windowStartedAt,
      ) as { usedCount: number } | undefined;

      if (usageRow && usageRow.usedCount > 0) {
        updateUsageStatement.run(
          usageRow.usedCount - 1,
          updatedAt,
          options.scope,
          subjectHash,
          windowStartedAt,
        );
      }

      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures after a failed transaction.
      }
      throw error;
    }

    return buildUsagePayload({
      limit: options.limit,
      usedAttempts: Math.max(((selectUsageStatement.get(
        options.scope,
        subjectHash,
        windowStartedAt,
      ) as { usedCount: number } | undefined)?.usedCount) || 0, 0),
      windowStartedAt,
      windowMs: options.windowMs,
    });
  };

  return {
    getUsage: req => readUsage(req),
    createReservation: req => {
      const currentTime = now();
      return {
        subjectHash: resolveSubjectHash(req, options.hmacSecret, options.trustProxy),
        windowStartedAt: resolveWindowStartedAt(currentTime, options.windowMs),
      };
    },
    consumeAttempt: req => consumeAttempt(
      resolveSubjectHash(req, options.hmacSecret, options.trustProxy),
      now(),
    ),
    refundAttempt: (req, reservation) => {
      const subjectHash = reservation?.subjectHash
        || resolveSubjectHash(req, options.hmacSecret, options.trustProxy);
      const windowStartedAt = reservation?.windowStartedAt
        ?? resolveWindowStartedAt(now(), options.windowMs);
      return refundAttempt(subjectHash, windowStartedAt);
    },
    close: () => db.close(),
  };
}

function initializeUsageSqliteSchema(db: DatabaseSync) {
  db.exec(`
    create table if not exists ai_usage_windows (
      scope text not null,
      subject_hash text not null,
      window_started_at integer not null,
      used_count integer not null,
      updated_at text not null,
      primary key (scope, subject_hash, window_started_at)
    );

    create index if not exists idx_ai_usage_windows_scope_time
      on ai_usage_windows(scope, window_started_at);
  `);
}

function resolveWindowStartedAt(currentTime: number, windowMs: number): number {
  return Math.floor(currentTime / windowMs) * windowMs;
}

function resolveSubjectHash(req: IncomingMessage | undefined, hmacSecret: string, trustProxy: boolean): string {
  const clientIp = req ? resolveClientIp(req, trustProxy) : null;
  return hashIp(clientIp || 'unknown', hmacSecret);
}

function buildUsagePayload(options: {
  limit: number;
  usedAttempts: number;
  windowStartedAt: number;
  windowMs: number;
}): ResumeIntakeUsage {
  return {
    remainingAttempts: Math.max(options.limit - options.usedAttempts, 0),
    limit: options.limit,
    resetAt: new Date(options.windowStartedAt + options.windowMs).toISOString(),
  };
}