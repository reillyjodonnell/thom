import { Logger } from "./logger.js";

type Task = {
  id: string;
  run: () => void | Promise<void>; // allow async
};

const LANES = ["domain", "ui"] as const;
const PRIOS = ["high", "medium", "low"] as const;
type Lane = (typeof LANES)[number];
type Prio = (typeof PRIOS)[number];

/*
  There is an edge case where the notifier is scheduled to sleep but an incoming task is added to the queue
  We have to keep track of this using a flag to prevent the deadlock
*/
class Notifier {
  private waitQueue = new Set<() => void>();
  private hasPendingSignal: boolean = false;

  wait() {
    if (this.hasPendingSignal) {
      this.hasPendingSignal = false;
      return Promise.resolve();
    }
    return new Promise<void>((res) => this.waitQueue.add(res));
  }

  signal() {
    if (this.waitQueue.size === 0) {
      this.hasPendingSignal = true;
    }
    for (const resume of this.waitQueue) resume();
    this.waitQueue.clear();
  }
}

export class Scheduler {
  private notifier;
  private logger?: Logger;
  private state: {
    status: "running" | "idle" | "stopped";
  };

  private queue: {
    domain: {
      high: Array<Task>;
      medium: Array<Task>;
      low: Array<Task>;
    };
    ui: {
      high: Array<Task>;
      medium: Array<Task>;
      low: Array<Task>;
    };
  };

  private getNext(): { lane: Lane; priority: Prio } | null {
    for (const lane of LANES) {
      for (const priority of PRIOS) {
        if (this.queue[lane][priority].length) return { lane, priority };
      }
    }
    return null;
  }

  constructor(logger: Logger) {
    this.logger = logger;
    this.state = {
      status: "idle",
    };
    this.queue = {
      domain: {
        high: [],
        medium: [],
        low: [],
      },
      ui: {
        high: [],
        medium: [],
        low: [],
      },
    };
    this.notifier = new Notifier();
  }

  stop() {
    this.state.status = "stopped";
    this.notifier.signal();
  }

  async start() {
    if (this.state.status === "running") return;
    if (this.state.status === "stopped") throw new Error("cannot restart");
    this.state.status = "running";
    while (this.state.status === "running") {
      const worked = await this.tick();

      if (!worked && this.state.status === "running") {
        this.state.status = "idle";
        await this.notifier.wait();
        if (this.state.status === "idle") this.state.status = "running";
      }
    }
  }

  private async tick(): Promise<boolean> {
    const next = this.getNext();
    if (!next) return false;
    const { lane, priority } = next;

    const task = this.queue[lane][priority].shift()!;
    const started = Date.now();
    const baseLog = {
      ts: started,
      kind: "scheduler",
      phase: "tick",
      taskId: task.id,
      priority,
      lane,
    };
    this.logger?.append({ ...baseLog, event: "start" }).catch?.(() => {});
    try {
      await task.run();
      const duration = Date.now() - started;
      this.logger
        ?.append({ ...baseLog, event: "end", durationMs: duration })
        .catch?.(() => {});
    } catch (err: any) {
      const duration = Date.now() - started;
      this.logger
        ?.append({
          ...baseLog,
          event: "error",
          durationMs: duration,
          error: err?.message || String(err),
        })
        .catch?.(() => {});
      console.error("[scheduler] task error:", err);
    }
    return true;
  }

  enqueue({
    task,
    priority,
    lane,
  }: {
    task: Task;
    priority: Prio;
    lane: Lane;
  }) {
    this.queue[lane][priority].push(task);
    this.notifier.signal();
  }
}
