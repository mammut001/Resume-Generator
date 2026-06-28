export function createSemaphore(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = async (): Promise<() => void> => {
    if (active < maxConcurrent) {
      active += 1;
      return release;
    }

    await new Promise<void>(resolve => {
      queue.push(resolve);
    });
    active += 1;
    return release;
  };

  function release() {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  }

  return { acquire };
}