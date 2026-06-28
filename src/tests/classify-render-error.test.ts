import { describe, expect, it } from 'vitest';
import { classifyRenderError, isRenderServiceUnavailable } from '@/features/resume-generator/lib/classifyRenderError';

describe('classifyRenderError', () => {
  it('detects unavailable render service responses', () => {
    expect(classifyRenderError('Render failed with status 500')).toBe('service_unavailable');
    expect(classifyRenderError('Failed to fetch')).toBe('service_unavailable');
    expect(isRenderServiceUnavailable('Render failed with status 500')).toBe(true);
  });

  it('treats compile errors as other failures', () => {
    expect(classifyRenderError('Typst compilation failed at line 12')).toBe('other');
    expect(isRenderServiceUnavailable('Typst compilation failed at line 12')).toBe(false);
  });
});