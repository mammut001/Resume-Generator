export type RenderErrorKind = 'service_unavailable' | 'other';

export function classifyRenderError(message: string): RenderErrorKind {
  const lower = message.toLowerCase();
  if (
    /status 500|status 502|status 503|status 504|failed to fetch|networkerror|network error|connection refused|econnrefused|fetch failed|load failed/i.test(
      lower,
    )
  ) {
    return 'service_unavailable';
  }
  return 'other';
}

export function isRenderServiceUnavailable(message: string | null | undefined): boolean {
  if (!message) return false;
  return classifyRenderError(message) === 'service_unavailable';
}