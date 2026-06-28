export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const now = options.now || Date.now;
  const counters = new Map<string, { count: number; windowStartedAt: number }>();

  return {
    consume(identifier: string): boolean {
      const currentTime = now();
      const bucket = counters.get(identifier);

      if (!bucket || currentTime - bucket.windowStartedAt > options.windowMs) {
        counters.set(identifier, { count: 1, windowStartedAt: currentTime });
        return true;
      }

      bucket.count += 1;
      return bucket.count <= options.limit;
    },
  };
}