import { describe, expect, test } from "bun:test";

import { createThrottle, type Clock } from "../src/throttle";

/** A clock that only moves when a sleep asks it to, so tests need no real delay. */
const fakeClock = (): Clock & { readonly elapsed: () => number } => {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    elapsed: () => time,
  };
};

describe("createThrottle", () => {
  test("runs tasks one at a time, never overlapping", async () => {
    const throttle = createThrottle(0, fakeClock());
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        throttle.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await Promise.resolve();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(1);
  });

  test("keeps the configured gap between consecutive starts", async () => {
    const clock = fakeClock();
    const throttle = createThrottle(2_000, clock);
    const starts: number[] = [];

    await Promise.all(
      Array.from({ length: 3 }, () =>
        throttle.run(async () => {
          starts.push(clock.now());
        }),
      ),
    );

    expect(starts).toEqual([0, 2_000, 4_000]);
  });

  test("does not delay the first task", async () => {
    const clock = fakeClock();
    await createThrottle(60_000, clock).run(async () => {});
    expect(clock.elapsed()).toBe(0);
  });

  test("preserves submission order", async () => {
    const throttle = createThrottle(0, fakeClock());
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) => throttle.run(async () => void order.push(n))),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("a failing task does not stall the queue", async () => {
    const throttle = createThrottle(0, fakeClock());

    await expect(
      throttle.run(async () => {
        throw new Error("upstream exploded");
      }),
    ).rejects.toThrow("upstream exploded");

    // The whole point: one rejection must not leave the chain permanently
    // pending, which would wedge every later lookup.
    expect(await throttle.run(async () => "still works")).toBe("still works");
  });

  test("reports how many tasks are queued or running", async () => {
    const throttle = createThrottle(0, fakeClock());
    expect(throttle.depth()).toBe(0);

    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = throttle.run(() => blocked);
    const second = throttle.run(async () => {});
    expect(throttle.depth()).toBe(2);

    release();
    await Promise.all([first, second]);
    expect(throttle.depth()).toBe(0);
  });
});
