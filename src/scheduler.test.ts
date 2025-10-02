import { describe, test, expect } from "bun:test";
import { Scheduler } from "./scheduler.js";
import { Logger } from "./logger.js";

// helper: fail if `p` doesn’t resolve in `ms`
function withTimeout<T>(p: Promise<T>, ms = 200): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

describe("Scheduler race conditions", () => {
  test("gap between tick() finishing and wait() call does NOT cause indefinite sleep", async () => {
    const logger = new Logger("");
    const scheduler = new Scheduler(logger);

    // Promise that resolves when our task runs
    let ranResolve!: () => void;
    const ran = new Promise<void>((res) => (ranResolve = res));
    // Enqueue on a MICROtask to land right before the loop calls wait()
    queueMicrotask(() => {
      scheduler.enqueue({
        task: {
          id: "m1",
          run: () => {
            console.log("Task started");
            return ranResolve();
          },
        },
        priority: "high",
        lane: "domain",
      });
    });

    // Start loop (do NOT await; it runs forever)
    void scheduler.start();

    // If the notifier had the lost-wakeup bug, this will timeout and fail the test
    await withTimeout(ran, 300);
    expect(true).toBe(true); // reached means the task ran
  });
});
