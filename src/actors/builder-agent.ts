// actors/builder-agent.ts
import type { Effect } from "../effect.js";
import type { Event } from "../events.js";
import { z } from "zod";
import type { AgentUiEvent } from "../ui-messages.js";

/* ----------------------------- SYSTEM PROMPT ----------------------------- */

const SYSTEM = `
You are a self-building agent.

You MUST reply with EXACTLY ONE JSON object that validates this schema:

{
  "schema_version": 1,
  "message": {
    "type": "step" | "action" | "deliverable" | "final",
    ...
  }
}

### Types:

- STEP:
  { "type": "step", "step": <int>, "goal": <string>, "say"?: <string> }

- ACTION:
  {
    "type": "action",
    "step": <int>,
    "toolcall_id": <string>,
    "tool": "fs" | "http",
    "args": { ... },  // see tools below
    "say"?: <string>
  }

- DELIVERABLE:
  {
    "type": "deliverable",
    "step": <int>,
    "kind": "path" | "url" | "text" | "code",
    "value": <string>,
    "meta"?: object,
    "say"?: <string>
  }

- FINAL:
  {
    "type": "final",
    "step": <int>,
    "summary": <string>,
    "deliverables": [{ "kind": "path"|"url"|"text", "value": <string> }]
  }

### TOOLS:

- fs:
  { "op": "read" | "write" | "append", "path": "string", "content"?: "string" }

- http:
  { "url": "https://...", "method"?: "GET"|"POST", "headers"?: object, "body"?: object }

### RULES:

- Always emit one JSON object per turn, no arrays, no extra text.
- Small steps: plan with "step", then if you need work done emit "action".
- Use unique toolcall_id for each "action".
- After ToolResult, react with the next "step", "action", or "final".
- Conclude with "final" when the goal is satisfied.
- Return ONLY JSON. No markdown, no code fences, no trailing commas.
- You have at most 12 steps this turn.
`.trim();

/* ----------------------------- ZOD CONTRACT ----------------------------- */

const Id = z.string().min(1);
const Step = z.number().int().min(1);

const FsArgs = z.object({
  op: z.enum(["read", "write", "append"]),
  path: z.string().min(1),
  content: z.string().optional(),
});

const HttpArgs = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]).optional().default("GET"),
  headers: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
});

const ToolName = z.enum(["fs", "http"]);

const PlannerMsg = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    step: Step,
    goal: z.string().min(1),
    say: z.string().optional(),
  }),
  z.object({
    type: z.literal("action"),
    step: Step,
    toolcall_id: Id,
    tool: ToolName,
    args: z.union([FsArgs, HttpArgs]),
    say: z.string().optional(),
  }),
  z.object({
    type: z.literal("deliverable"),
    step: Step,
    kind: z.enum(["path", "url", "text", "code"]),
    value: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    say: z.string().optional(),
  }),
  z.object({
    type: z.literal("final"),
    step: Step,
    summary: z.string().min(1),
    deliverables: z
      .array(
        z.object({
          kind: z.enum(["path", "url", "text"]),
          value: z.string(),
        })
      )
      .default([]),
  }),
]);

const PlannerTurn = z.object({
  schema_version: z.literal(1),
  message: PlannerMsg,
});
type PlannerTurn = z.infer<typeof PlannerTurn>;
type PlannerMsg = z.infer<typeof PlannerMsg>;

/* ------------------------------ AGENT CLASS ----------------------------- */

export class BuilderAgent {
  private readonly MAX_STEPS = 12;
  private readonly MAX_REPAIRS = 2;

  private interrupted = false;
  private steps = 0;

  private currentReqId: string | null = null;

  private emitPlanningStop(
    reason: "final" | "error" | "interrupted" | "max-steps",
    detail?: string
  ) {
    if (!this.currentReqId) return;
    this.onUpdate({
      kind: "planning-stop",
      agentId: this.id,
      requestId: this.currentReqId,
      reason,
      ...(detail ? { detail } : {}),
    });
    this.currentReqId = null;
  }

  // rolling transcript; simple role/content pairs for the planner context
  private convo: { role: "system" | "user" | "assistant"; content: string }[] =
    [{ role: "system", content: SYSTEM }];

  constructor(
    public id: string,
    private submitEffect: (e: Effect) => void,
    private llmOnce: (prompt: string, target: string) => Promise<string>,
    private onUpdate: (evt: AgentUiEvent) => void
  ) {}

  interrupt() {
    this.interrupted = true;
  }

  on(event: Event) {
    if (event.type === "UserInput" && event.target === this.id) {
      this.currentReqId = event.reqId ?? `turn-${Date.now()}`;
      const requestId = this.currentReqId;
      this.convo.push({ role: "user", content: event.text });
      this.steps = 0;
      this.interrupted = false;
      this.onUpdate({
        kind: "user-turn",
        agentId: this.id,
        requestId,
        text: event.text,
      });
      this.onUpdate({
        kind: "planning-start",
        agentId: this.id,
        requestId,
      });
      void this.loop();
      return;
    }

    if (event.type === "ToolResult" && event.target === this.id) {
      const truncated = event.data.slice(0, 2000);
      // Add observation to convo as user turn so planner can react
      this.convo.push({
        role: "user",
        content: `TOOL(${event.tool}) -> ${
          event.ok ? "ok" : "error"
        }\n${truncated}`,
      });
      this.onUpdate({
        kind: "observation",
        tool: event.tool,
        ok: event.ok,
        data: truncated,
      });
      void this.loop();
      return;
    }

    if (event.type === "LlmError" && event.target === this.id) {
      this.onUpdate({
        kind: "error",
        phase: "llm",
        message: event.error,
      });
      this.emitPlanningStop("error", event.error);
      return;
    }
  }

  /* ---------------------------- Planner Loop ---------------------------- */

  private async loop() {
    if (this.interrupted) {
      this.onUpdate({ kind: "status", status: "interrupted" });
      this.emitPlanningStop("interrupted");
      return;
    }
    if (this.steps >= this.MAX_STEPS) {
      this.onUpdate({ kind: "status", status: "max-steps" });
      this.emitPlanningStop(
        "max-steps",
        `Reached ${this.MAX_STEPS} planner steps`
      );
      return;
    }
    this.steps++;

    const prompt =
      this.convo
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n") +
      `\n\nReturn ONLY JSON: {"schema_version":1,"message":{...}} matching the schema exactly.`;

    // 1) get model text once (non-streaming)
    let raw: string | null = await this.llmOnce(prompt, this.id).catch((e) => {
      const message = String(e?.message ?? e);
      this.onUpdate({
        kind: "error",
        phase: "planner",
        message,
      });
      this.emitPlanningStop("error", message);
      return null;
    });
    if (raw == null) return;

    // 2) validate or repair
    const turn = await this.parseOrRepair(raw, async (repairHint) => {
      const repairMsg =
        `Your last response was invalid.\n` +
        `Validation error(s):\n${repairHint}\n\n` +
        `Re-emit ONLY a correct JSON object: {"schema_version":1,"message":{...}}. No extra text.`;

      this.convo.push({ role: "user", content: repairMsg });
      const reOut = await this.llmOnce(
        this.convo
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n") + `\n\nReturn ONLY JSON matching the schema.`,
        this.id
      );
      return reOut;
    }).catch((e) => {
      const message = `planner output invalid: ${String(e?.message ?? e)}`;
      this.onUpdate({
        kind: "error",
        phase: "planner",
        message,
      });
      this.emitPlanningStop("error", message);
      return null;
    });
    if (!turn) return;

    // 3) record model message as assistant turn (raw JSON)
    this.convo.push({
      role: "assistant",
      content: JSON.stringify(turn.message),
    });

    // 4) act on the message deterministically
    await this.handleMessage(turn.message);
  }

  /* ----------------------- Message Handling / Actions ------------------- */

  private async handleMessage(msg: PlannerMsg) {
    switch (msg.type) {
      case "step": {
        this.onUpdate({
          kind: "step",
          step: msg.step,
          goal: msg.goal,
          ...(msg.say ? { say: msg.say } : {}),
        });
        void this.loop();
        return;
      }
      case "action": {
        this.onUpdate({
          kind: "action",
          step: msg.step,
          tool: msg.tool,
          toolcallId: msg.toolcall_id,
          args: msg.args,
          ...(msg.say ? { say: msg.say } : {}),
        });
        this.submitEffect({
          kind: "ToolCall",
          tool: msg.tool,
          args: msg.args,
          target: this.id,
        });
        return;
      }
      case "deliverable": {
        this.onUpdate({
          kind: "deliverable",
          step: msg.step,
          deliverable: {
            kind: msg.kind,
            value: msg.value,
            ...(msg.meta ? { meta: msg.meta } : {}),
            ...(msg.say ? { say: msg.say } : {}),
          },
        });
        void this.loop();
        return;
      }
      case "final": {
        this.onUpdate({
          kind: "final",
          step: msg.step,
          summary: msg.summary.trim(),
          deliverables: msg.deliverables,
        });
        this.emitPlanningStop("final");
        return;
      }
    }
  }

  // renderDeliverable removed in favor of structured events

  /* ----------------------- Validation + Repair Loop --------------------- */

  private async parseOrRepair(
    raw: string,
    ask: (repairHint: string) => Promise<string>
  ): Promise<PlannerTurn> {
    let lastErr = "";
    for (let i = 0; i <= this.MAX_REPAIRS; i++) {
      try {
        const obj = JSON.parse(raw);
        return PlannerTurn.parse(obj);
      } catch (err: any) {
        // Prepare a concise hint
        const hint = (
          err?.issues
            ? JSON.stringify(err.issues, null, 2)
            : err?.message ?? String(err)
        ) as string;
        lastErr = hint.slice(0, 2000);

        if (i === this.MAX_REPAIRS) break;
        raw = await ask(lastErr);
      }
    }
    throw new Error(lastErr || "unknown validation error");
  }
}
