import { mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteUsageStore, IntakeUsageStore } from '../src/intake/usageStore';

describe('sqlite AI usage store', () => {
  const tempDirectories: string[] = [];
  const stores: IntakeUsageStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close?.();
    }

    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('tracks usage per client within the current window', () => {
    const databasePath = createTempDatabasePath();
    const currentTime = Date.parse('2026-05-19T00:00:00.000Z');
    const store = createSqliteUsageStore({
      databasePath,
      scope: 'intake',
      limit: 2,
      windowMs: 60_000,
      hmacSecret: 'usage-secret',
      trustProxy: true,
      now: () => currentTime,
    });
    stores.push(store);

    const firstClient = createRequest('203.0.113.10');
    const secondClient = createRequest('203.0.113.11');

    expect(store.getUsage(firstClient)).toEqual({
      remainingAttempts: 2,
      limit: 2,
      resetAt: '2026-05-19T00:01:00.000Z',
    });

    store.consumeAttempt(firstClient);
    expect(store.getUsage(firstClient)).toEqual({
      remainingAttempts: 1,
      limit: 2,
      resetAt: '2026-05-19T00:01:00.000Z',
    });

    store.consumeAttempt(firstClient);

    expect(() => store.consumeAttempt(firstClient)).toThrowError(/current window/i);
    expect(store.getUsage(secondClient)).toEqual({
      remainingAttempts: 2,
      limit: 2,
      resetAt: '2026-05-19T00:01:00.000Z',
    });
  });

  it('persists usage across restarts and keeps scopes separate', () => {
    const databasePath = createTempDatabasePath();
    let currentTime = Date.parse('2026-05-19T10:15:00.000Z');
    const request = createRequest('198.51.100.24');

    const firstIntakeStore = createSqliteUsageStore({
      databasePath,
      scope: 'intake',
      limit: 3,
      windowMs: 60_000,
      hmacSecret: 'usage-secret',
      trustProxy: false,
      now: () => currentTime,
    });
    stores.push(firstIntakeStore);

    const tailoringStore = createSqliteUsageStore({
      databasePath,
      scope: 'tailoring',
      limit: 2,
      windowMs: 60_000,
      hmacSecret: 'usage-secret',
      trustProxy: false,
      now: () => currentTime,
    });
    stores.push(tailoringStore);

    firstIntakeStore.consumeAttempt(request);
    tailoringStore.consumeAttempt(request);

    expect(firstIntakeStore.getUsage(request).remainingAttempts).toBe(2);
    expect(tailoringStore.getUsage(request).remainingAttempts).toBe(1);

    firstIntakeStore.close?.();
    stores.splice(stores.indexOf(firstIntakeStore), 1);

    const restartedIntakeStore = createSqliteUsageStore({
      databasePath,
      scope: 'intake',
      limit: 3,
      windowMs: 60_000,
      hmacSecret: 'usage-secret',
      trustProxy: false,
      now: () => currentTime,
    });
    stores.push(restartedIntakeStore);

    expect(restartedIntakeStore.getUsage(request)).toEqual({
      remainingAttempts: 2,
      limit: 3,
      resetAt: '2026-05-19T10:16:00.000Z',
    });

    currentTime += 60_000;

    expect(restartedIntakeStore.getUsage(request)).toEqual({
      remainingAttempts: 3,
      limit: 3,
      resetAt: '2026-05-19T10:17:00.000Z',
    });
    expect(tailoringStore.getUsage(request)).toEqual({
      remainingAttempts: 2,
      limit: 2,
      resetAt: '2026-05-19T10:17:00.000Z',
    });
  });

  function createTempDatabasePath() {
    const directory = mkdtempSync(join(tmpdir(), 'resume-ai-usage-'));
    tempDirectories.push(directory);
    return join(directory, 'usage.sqlite');
  }

  function createRequest(ip: string): IncomingMessage {
    return {
      headers: {},
      socket: { remoteAddress: ip },
    } as IncomingMessage;
  }
});