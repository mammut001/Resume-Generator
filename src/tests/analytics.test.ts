import { describe, expect, it, vi } from 'vitest';
import { sanitizeAnalyticsPayload, trackAnalyticsEvent } from '@/lib/analytics';

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