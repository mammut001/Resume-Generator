import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedPersist } from '@/features/resume-generator/lib/debouncedPersist';

describe('createDebouncedPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces flush calls until the delay elapses', () => {
    const flush = vi.fn();
    const persist = createDebouncedPersist(flush, { delayMs: 400 });

    persist.schedule('first');
    persist.schedule('second');
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('second');
  });

  it('flushes pending values immediately', () => {
    const flush = vi.fn();
    const persist = createDebouncedPersist(flush, { delayMs: 400 });

    persist.schedule('pending');
    persist.flushNow();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('pending');

    vi.advanceTimersByTime(400);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('cancels pending writes without flushing', () => {
    const flush = vi.fn();
    const persist = createDebouncedPersist(flush, { delayMs: 400 });

    persist.schedule('pending');
    persist.cancel();

    vi.advanceTimersByTime(400);
    expect(flush).not.toHaveBeenCalled();
  });
});