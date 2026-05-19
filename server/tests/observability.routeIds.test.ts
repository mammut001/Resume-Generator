import { describe, expect, it } from 'vitest';
import { resolveRouteId } from '../src/observability/routeIds';

describe('observability route IDs', () => {
  it('maps supported routes to stable route IDs', () => {
    expect(resolveRouteId('/health')).toBe('health');
    expect(resolveRouteId('/api/observability/summary')).toBe('observability_summary');
    expect(resolveRouteId('/api/observability/admin/token')).toBe('observability_admin_token');
    expect(resolveRouteId('/api/render/typst')).toBe('render_typst');
    expect(resolveRouteId('/api/intake/usage')).toBe('intake_usage');
    expect(resolveRouteId('/api/intake/text')).toBe('intake_text');
    expect(resolveRouteId('/api/intake/pdf')).toBe('intake_pdf');
    expect(resolveRouteId('/api/tailor/usage')).toBe('tailor_usage');
    expect(resolveRouteId('/api/tailor/resume')).toBe('tailor_resume');
  });

  it('maps unknown routes to not_found', () => {
    expect(resolveRouteId('/api/intake/unknown')).toBe('not_found');
    expect(resolveRouteId('/api/unknown')).toBe('not_found');
  });
});