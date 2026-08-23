/**
 * Serialises requests to javdb and spaces them out.
 *
 * The scarce resource is the cf_clearance cookie, not CPU: two callers scraping
 * at once look like a bot and get the cookie burned for everyone. So every
 * upstream request goes through one queue, one at a time, with a floor on the
 * gap between consecutive starts. One lookup costs two of these -- a search and
 * a detail page -- and both are paced.
 */

export interface Clock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Throttle {
  /** Run a task once the queue reaches it and the interval has elapsed. */
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
  /** How many tasks are queued or running. */
  readonly depth: () => number;
}

export const createThrottle = (minIntervalMs: number, clock: Clock = REAL_CLOCK): Throttle => {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let depth = 0;

  const run = async <T>(task: () => Promise<T>): Promise<T> => {
    depth += 1;

    const result = tail.then(async () => {
      const wait = lastStartedAt + minIntervalMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
      lastStartedAt = clock.now();
      return task();
    });

    // The chain must survive a rejected task, or one failure stalls the queue
    // forever. Swallow here only; the caller still sees the rejection below.
    tail = result.then(
      () => undefined,
      () => undefined,
    );

    try {
      return await result;
    } finally {
      depth -= 1;
    }
  };

  return { run, depth: () => depth };
};
