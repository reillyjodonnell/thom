import { Event } from "../events.js";
import { Scheduler } from "../scheduler.js";
import { LlmPort } from "./openai-port.js";

export class LlmAdapter {
  constructor(
    private llm: LlmPort,
    private scheduler: Scheduler,
    private dispatch: (e: Event | any) => void
  ) {}

  run(prompt: string, target: string) {
    const reqId = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    let tokenCount = 0;

    // UI: signal model work started
    this.dispatch({
      kind: "llm-start",
      target,
      requestId: reqId,
      promptPreview: prompt.slice(0, 160),
    } as any);

    this.scheduler.enqueue({
      task: {
        id: reqId,
        run: async () => {
          try {
            for await (const chunk of this.llm.generate(prompt)) {
              tokenCount++;
              this.dispatch({
                type: "TokenChunk",
                text: chunk,
                target,
                reqId,
              } as Event);
              this.dispatch({
                kind: "stream-token",
                target,
                token: chunk,
              });
            }
            this.dispatch({ kind: "stream-done", target });
            this.dispatch({
              type: "LlmComplete",
              target,
              reqId,
            } as Event);
            this.dispatch({
              kind: "llm-end",
              target,
              requestId: reqId,
              durationMs: Date.now() - started,
              tokens: tokenCount,
            });
          } catch (err: any) {
            const msg =
              (err && (err.message || String(err))) || "unknown error";
            this.dispatch({
              type: "LlmError",
              error: msg,
              target,
              reqId,
            } as Event);
            this.dispatch({ kind: "stream-done", target });
            this.dispatch({
              kind: "llm-end",
              target,
              requestId: reqId,
              durationMs: Date.now() - started,
              tokens: tokenCount,
            });
          }
        },
      },
      lane: "domain",
      priority: "medium",
    });
  }

  async runOnce(prompt: string, target: string): Promise<string> {
    const reqId = `llm-once-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const started = Date.now();

    this.dispatch({
      kind: "llm-start",
      target,
      requestId: reqId,
      promptPreview: prompt.slice(0, 160),
    } as any);

    // gather chunks into a single string (non-streaming to the agent)
    let buf = "";
    await new Promise<void>((resolve, reject) => {
      this.scheduler.enqueue({
        task: {
          id: reqId,
          run: async () => {
            try {
              for await (const chunk of this.llm.generate(prompt)) buf += chunk;
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        },
        lane: "domain",
        priority: "medium",
      });
    }).catch((e) => {
      this.dispatch({
        kind: "llm-end",
        target,
        requestId: reqId,
        durationMs: Date.now() - started,
      } as any);
      throw e;
    });

    this.dispatch({
      kind: "llm-end",
      target,
      requestId: reqId,
      durationMs: Date.now() - started,
      tokens: buf.length ? buf.split(/\s+/).length : 0, // rough fallback
    } as any);

    return buf;
  }
}
