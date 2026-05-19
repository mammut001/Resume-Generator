import { RouteId } from './types.js';

export function resolveRouteId(pathname: string): RouteId {
  switch (pathname) {
    case '/health':
      return 'health';
    case '/api/observability/summary':
      return 'observability_summary';
    case '/api/observability/admin/token':
      return 'observability_admin_token';
    case '/api/render/typst':
      return 'render_typst';
    case '/api/intake/usage':
      return 'intake_usage';
    case '/api/intake/text':
      return 'intake_text';
    case '/api/intake/pdf':
      return 'intake_pdf';
    case '/api/tailor/usage':
      return 'tailor_usage';
    case '/api/tailor/resume':
      return 'tailor_resume';
    default:
      return 'not_found';
  }
}