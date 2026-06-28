import { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createIntakeUsageStore } from '../src/intake/usageStore';
import { withQuotaReservation } from '../src/lib/quotaReservation';

describe('withQuotaReservation', () => {
  it('refunds quota when reserved work fails', async () => {
    const store = createIntakeUsageStore(1);
    const request = {
      headers: {},
      socket: { remoteAddress: '203.0.113.44' },
    } as IncomingMessage;

    await expect(withQuotaReservation(store, request, async () => {
      throw new Error('model failed');
    })).rejects.toThrow('model failed');

    expect(store.getUsage(request)).toEqual({
      remainingAttempts: 1,
      limit: 1,
      resetAt: null,
    });
  });

  it('keeps quota consumed when reserved work succeeds', async () => {
    const store = createIntakeUsageStore(1);
    const request = {
      headers: {},
      socket: { remoteAddress: '203.0.113.45' },
    } as IncomingMessage;

    await withQuotaReservation(store, request, async () => undefined);

    expect(store.getUsage(request)).toEqual({
      remainingAttempts: 0,
      limit: 1,
      resetAt: null,
    });
  });
});