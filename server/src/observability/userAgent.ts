export function resolveUserAgentFamily(userAgentHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
  if (!value) return 'unknown';

  const normalized = value.toLowerCase();

  if (normalized.includes('edg/')) return 'edge';
  if (normalized.includes('firefox/')) return 'firefox';
  if (normalized.includes('node') || normalized.includes('undici') || normalized.includes('node-fetch')) return 'node';
  if (normalized.includes('chrome/') || normalized.includes('crios/')) return 'chrome';
  if (normalized.includes('safari/') && !normalized.includes('chrome/')) return 'safari';

  return 'other';
}