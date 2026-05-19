import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeObservabilitySqliteSchema } from './sqliteSink.js';

const ADMIN_TOKEN_ROW_ID = 1;

type PersistedAdminTokenRow = {
  token_sha256: string;
  updated_at: string;
};

export type ObservabilityAdminTokenStore = {
  isAuthorized: (token: string | undefined) => boolean;
  rotateToken: (nextToken: string) => { updatedAt: string };
  close: () => void;
};

export function createObservabilityAdminTokenStore(databasePath: string, bootstrapToken: string | undefined): ObservabilityAdminTokenStore {
  const db = new DatabaseSync(databasePath);
  initializeObservabilitySqliteSchema(db);

  const selectTokenStatement = db.prepare(`
    select token_sha256, updated_at
    from observability_admin_tokens
    where id = ?
    limit 1
  `);

  const upsertTokenStatement = db.prepare(`
    insert into observability_admin_tokens (
      id,
      token_sha256,
      updated_at
    ) values (?, ?, ?)
    on conflict(id) do update set
      token_sha256 = excluded.token_sha256,
      updated_at = excluded.updated_at
  `);

  let persistedToken = readPersistedToken();

  return {
    isAuthorized: token => {
      const normalizedToken = normalizeToken(token);
      if (!normalizedToken) {
        return false;
      }

      const expectedHash = persistedToken?.token_sha256 || (bootstrapToken ? hashToken(bootstrapToken) : undefined);
      if (!expectedHash) {
        return false;
      }

      return timingSafeHexEquals(hashToken(normalizedToken), expectedHash);
    },
    rotateToken: nextToken => {
      const normalizedToken = normalizeToken(nextToken);
      if (!normalizedToken) {
        throw new Error('Admin token is required.');
      }

      const updatedAt = new Date().toISOString();
      persistedToken = {
        token_sha256: hashToken(normalizedToken),
        updated_at: updatedAt,
      };

      upsertTokenStatement.run(ADMIN_TOKEN_ROW_ID, persistedToken.token_sha256, persistedToken.updated_at);
      return { updatedAt };
    },
    close: () => {
      db.close();
    },
  };

  function readPersistedToken(): PersistedAdminTokenRow | undefined {
    return selectTokenStatement.get(ADMIN_TOKEN_ROW_ID) as PersistedAdminTokenRow | undefined;
  }
}

function normalizeToken(token: string | undefined) {
  const normalized = token?.trim();
  return normalized ? normalized : undefined;
}

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function timingSafeHexEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}