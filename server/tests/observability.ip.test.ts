import { describe, expect, it } from 'vitest';
import { hashIp, hashNetwork, normalizeIp, resolveClientIp } from '../src/observability/ip';

describe('observability IP helpers', () => {
  it('normalizes IPv4-mapped addresses', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('hashes the same IP deterministically', () => {
    expect(hashIp('127.0.0.1', 'test-secret')).toBe(hashIp('127.0.0.1', 'test-secret'));
    expect(hashNetwork('127.0.0.1', 'test-secret')).toBe(hashNetwork('127.0.0.1', 'test-secret'));
  });

  it('changes hashes when the secret changes', () => {
    expect(hashIp('127.0.0.1', 'secret-a')).not.toBe(hashIp('127.0.0.1', 'secret-b'));
  });

  it('ignores proxy headers unless trustProxy is enabled', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
    };

    expect(resolveClientIp(req as never, false)).toBe('127.0.0.1');
    expect(resolveClientIp(req as never, true)).toBe('203.0.113.10');
  });
});