type DebouncedPersistOptions = {
  delayMs?: number;
};

export function createDebouncedPersist<T>(flush: (value: T) => void, options: DebouncedPersistOptions = {}) {
  const delayMs = options.delayMs ?? 400;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;

  const schedule = (value: T) => {
    pending = value;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      if (pending === undefined) return;
      const next = pending;
      pending = undefined;
      flush(next);
    }, delayMs);
  };

  const flushNow = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (pending === undefined) return;
    const next = pending;
    pending = undefined;
    flush(next);
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    pending = undefined;
  };

  return { schedule, flushNow, cancel };
}