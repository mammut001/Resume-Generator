export type AnalyticsEventName =
  | 'onboarding_viewed'
  | 'onboarding_dismissed'
  | 'intake_started'
  | 'intake_completed'
  | 'pdf_packet_blocked'
  | 'pdf_page_range_selected'
  | 'tailoring_started'
  | 'tailoring_completed'
  | 'tailoring_change_rejected'
  | 'tailoring_applied'
  | 'document_created'
  | 'document_duplicated'
  | 'document_deleted'
  | 'export_started'
  | 'export_completed'
  | 'export_failed';

export type AnalyticsPayload = Record<string, string | number | boolean | string[] | number[] | null | undefined>;

const sensitiveKeyPattern = /(resume|job|description|text|content|raw|model|name|email|phone|url|link|address)/i;

export function trackAnalyticsEvent(event: AnalyticsEventName, payload: AnalyticsPayload = {}): void {
  const safePayload = sanitizeAnalyticsPayload(payload);

  if (isAnalyticsDebugEnabled()) {
    console.info('[analytics]', { event, payload: safePayload });
  }
}

export function sanitizeAnalyticsPayload(payload: AnalyticsPayload): AnalyticsPayload {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key, value]) => value !== undefined && !sensitiveKeyPattern.test(key))
      .map(([key, value]) => [key, normalizeAnalyticsValue(value)]),
  );
}

function normalizeAnalyticsValue(value: AnalyticsPayload[string]) {
  if (Array.isArray(value)) return value.slice(0, 20);
  if (typeof value === 'string') return value.slice(0, 80);
  return value;
}

function isAnalyticsDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && import.meta.env?.VITE_ANALYTICS_DEBUG === '1') {
    return true;
  }

  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('resume-generator-analytics-debug') === '1';
  } catch {
    return false;
  }
}