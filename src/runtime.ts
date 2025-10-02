import { join } from "node:path";
import { LlmAdapter } from "./drivers/llm.js";
import { OpenAIResponsesPort } from "./drivers/openai-port.js";
import { Event } from "./events.js";
import { Logger } from "./logger.js";
import { Router } from "./router.js";
import { Scheduler } from "./scheduler.js";
import { mkdir } from "node:fs/promises";
import { ToolsAdapter } from "./runtime/tools-adapter.js";
import { FsPort } from "./drivers/fs-port.js";
import { HttpPort } from "./drivers/http-port.js";
import { BuilderAgent } from "./actors/builder-agent.js";
import { Effect } from "./effect.js";
import type { AgentUiEvent } from "./ui-messages.js";

export class Runtime {
  private scheduler: Scheduler;
  private logger: Logger;
  private router: Router;
  private status: "idle" | "running";
  private llm: LlmAdapter;
  private tools: ToolsAdapter;
  private readonly onReplyUpdate: (evt: AgentUiEvent) => void;
  private readonly sessionId: string;
  private constructor(
    onReplyUpdate: (evt: AgentUiEvent) => void,
    logFile: string
  ) {
    this.logger = new Logger(logFile);
    this.onReplyUpdate = onReplyUpdate;
    this.sessionId = `session-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.scheduler = new Scheduler(this.logger);
    this.router = new Router();
    this.tools = new ToolsAdapter(this.scheduler, (e) => this.dispatch(e));
    this.tools.register(new FsPort(process.cwd()));
    this.tools.register(new HttpPort());
    this.llm = new LlmAdapter(
      new OpenAIResponsesPort(apiKey, undefined, undefined, this.logger),
      this.scheduler,
      (e: any) => this.dispatch(e)
    );
    const submitEffect = (eff: Effect) => {
      if (eff.kind === "LlmGenerate") this.llm.run(eff.prompt, eff.target);
      else if (eff.kind === "ToolCall") this.tools.submit(eff);
    };

    const builder = new BuilderAgent(
      "agent#1",
      submitEffect,
      (prompt, target) => this.llm.runOnce(prompt, target), // non-streaming planner
      onReplyUpdate
    );
    this.router.register(builder);
    this.onReplyUpdate({
      kind: "session-start",
      sessionId: this.sessionId,
      agentId: builder.id,
      at: Date.now(),
    });
    this.status = "idle";
  }

  static async init(
    onReplyUpdate: (evt: AgentUiEvent) => void
  ): Promise<Runtime> {
    const logDir = join(process.cwd(), "logs");
    await mkdir(logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(logDir, `runtime-${timestamp}.log`);
    return new Runtime(onReplyUpdate, logFile);
  }

  start(): void {
    if (this.status === "running") return;
    this.scheduler.start();
    this.status = "running";
  }

  stop(): void {
    if (this.status !== "running") return;
    this.scheduler.stop();
    this.status = "idle";
  }

  interrupt(target: string): void {
    const actor = this.router.get(target) as any;
    if (actor && typeof (actor as any).interrupt === "function") {
      (actor as any).interrupt();
    }
  }

  dispatch(event: any): void {
    // Log all events (runtime Events + UI events like llm-start/llm-end)
    this.logger.append({ ts: Date.now(), event }).catch(() => {});
    // Forward UI events directly to the presentation callback
    if (event && typeof event === "object" && "kind" in event) {
      this.onReplyUpdate(event as AgentUiEvent);
    }
    // Forward only internal runtime events (those with a 'type' field) to actors
    if (event && typeof event === "object" && "type" in event) {
      this.router.dispatch(event as Event);
    }
  }
}
