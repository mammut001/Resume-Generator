import { describe, expect, it, vi } from 'vitest';
import { sanitizeAnalyticsPayload, sendAnalyticsEvent, trackAnalyticsEvent } from '@/lib/analytics';

describe('analytics', () => {
  it('removes sensitive raw content fields from payloads', () => {
    expect(sanitizeAnalyticsPayload({
      source: 'pdf',
      resumeText: 'private resume text',
      jobDescription: 'private JD',
      email: 'alex@example.com',
      phone: '555-0100',
      section: 'summary',
      count: 2,
    })).toEqual({
      source: 'pdf',
      section: 'summary',
      count: 2,
    });
  });

  it('keeps event tracking no-op by default', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    trackAnalyticsEvent('export_completed', { format: 'pdf', issueCount: 0 });

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('sends a sanitized event via the configured beacon when an endpoint is set', () => {
    const beacon = vi.fn().mockReturnValue(true);
    const fixedNow = new Date('2026-05-20T10:00:00.000Z');
    sendAnalyticsEvent(
      '/api/analytics/event',
      'export_completed',
      { format: 'pdf', issueCount: 0 },
      () => fixedNow,
      beacon,
    );
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe('/api/analytics/event');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
  });

  it('swallows beacon errors so analytics never breaks the app', () => {
    const beacon = vi.fn().mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() =>
      sendAnalyticsEvent('/api/analytics/event', 'export_started', { format: 'pdf' }, () => new Date(), beacon),
    ).not.toThrow();
  });

  it('stabilizes payload values for future adapters', () => {
    expect(sanitizeAnalyticsPayload({
      warningCodes: Array.from({ length: 30 }, (_, index) => `warning_${index}`),
      mode: 'a'.repeat(120),
    })).toEqual({
      warningCodes: Array.from({ length: 20 }, (_, index) => `warning_${index}`),
      mode: 'a'.repeat(80),
    });
  });
});
