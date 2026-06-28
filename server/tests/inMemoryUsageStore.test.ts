import { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createIntakeUsageStore } from '../src/intake/usageStore';

describe('in-memory AI usage store', () => {
  it('tracks usage per client independently', () => {
    const store = createIntakeUsageStore(2);
    const firstClient = createRequest('203.0.113.10');
    const secondClient = createRequest('203.0.113.11');

    expect(store.getUsage(firstClient)).toEqual({
      remainingAttempts: 2,
      limit: 2,
      resetAt: null,
    });

    store.consumeAttempt(firstClient);
    expect(store.getUsage(firstClient)).toEqual({
      remainingAttempts: 1,
      limit: 2,
      resetAt: null,
    });
    expect(store.getUsage(secondClient)).toEqual({
      remainingAttempts: 2,
      limit: 2,
      resetAt: null,
    });
  });

  function createRequest(ip: string): IncomingMessage {
    return {
      headers: {},
      socket: { remoteAddress: ip },
    } as IncomingMessage;
  }
});