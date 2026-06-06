export type AnalyticsEventName =
  | 'page_viewed'
  | 'onboarding_viewed'
  | 'onboarding_dismissed'
  | 'start_action_clicked'
  | 'intake_started'
  | 'intake_completed'
  | 'intake_failed'
  | 'pdf_packet_blocked'
  | 'pdf_page_range_selected'
  | 'tailoring_started'
  | 'tailoring_completed'
  | 'tailoring_change_rejected'
  | 'tailoring_applied'
  | 'document_created'
  | 'document_duplicated'
  | 'document_deleted'
  | 'export_tab_viewed'
  | 'export_started'
  | 'export_completed'
  | 'export_failed';

export type AnalyticsPayload = Record<string, string | number | boolean | string[] | number[] | null | undefined>;

const sensitiveKeyPattern = /(resume|job|description|text|content|raw|model|name|email|phone|url|link|address)/i;

export function trackAnalyticsEvent(event: AnalyticsEventName, payload: AnalyticsPayload = {}): void {
  const safePayload = sanitizeAnalyticsPayload(payload);
  const endpoint = resolveAnalyticsEndpoint();

  if (isAnalyticsDebugEnabled()) {
    console.info('[analytics]', { event, payload: safePayload });
  }

  if (endpoint) {
    sendAnalyticsEvent(endpoint, event, safePayload);
  }
}

export function sendAnalyticsEvent(
  endpoint: string,
  event: AnalyticsEventName,
  safePayload: AnalyticsPayload,
  now: () => Date = () => new Date(),
  beacon: (url: string, data: Blob) => boolean = defaultSendBeacon,
): void {
  if (typeof beacon !== 'function') return;
  const body = JSON.stringify({
    event,
    payload: safePayload,
    occurredAt: now().toISOString(),
  });
  try {
    beacon(endpoint, new Blob([body], { type: 'application/json' }));
  } catch {
    // sendBeacon can throw on quota / insecure-context errors; analytics must never break the app.
  }
}

function defaultSendBeacon(url: string, data: Blob): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  return navigator.sendBeacon(url, data);
}

export function resolveAnalyticsEndpoint(): string | null {
  if (typeof import.meta === 'undefined' || !import.meta.env) return null;
  const raw = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) return null;
  return trimmed;
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
