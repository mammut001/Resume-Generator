import { describe, expect, it } from 'vitest';
import { sanitizeSvgHtml } from '@/features/resume-generator/lib/sanitizeSvgHtml';

describe('sanitizeSvgHtml', () => {
  it('removes script tags and inline event handlers from svg html', () => {
    const dirty = '<svg><script>alert(1)</script><rect onclick="alert(1)" /></svg>';
    expect(sanitizeSvgHtml(dirty)).toBe('<svg><rect /></svg>');
  });
});