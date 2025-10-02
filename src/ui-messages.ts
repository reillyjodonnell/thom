/**
 * ui-messages.ts
 *
 * Structured UI event contract emitted by agents (e.g. BuilderAgent) so that
 * any presentation layer (CLI, TUI, Web, etc.) can deterministically map
 * semantics to concrete UI elements (colors, widgets, hyperlinks, code blocks, etc).
 *
 * DO NOT put display / ANSI / styling concerns inside the agent—emit only
 * semantic events and let the UI decide how to render them.
 */

/* -------------------------------------------------------------------------- */
/*  Deliverable + Core Event Union                                            */
/* -------------------------------------------------------------------------- */

export type DeliverableKind = "path" | "url" | "text" | "code";

/**
 * Canonical list of agent lifecycle event kinds. Use this to drive
 * exhaustive `switch` statements in UI renderers.
 */
export const AGENT_UI_EVENT_KINDS = [
  "session-start",
  "user-turn",
  "planning-start",
  "step",
  "action",
  "observation",
  "deliverable",
  "final",
  "status",
  "error",
  "planning-stop",
  "llm-start",
  "stream-token",
  "stream-done",
  "llm-end",
] as const;

export type AgentUiEventKind = (typeof AGENT_UI_EVENT_KINDS)[number];

/**
 * A single semantic event destined for UI presentation.
 *
 * Each variant is intentionally flat and discriminated by the `kind` field.
 * Keep payloads JSON-serializable; avoid class instances or cyclic objects.
 */
export type AgentUiEvent =
  | {
      kind: "session-start";
      /** Runtime-assigned session identifier (unique per run). */
      sessionId: string;
      /** Agent instance responsible for handling the session. */
      agentId: string;
      /** Epoch millis when the session became active. */
      at: number;
    }
  | {
      kind: "user-turn";
      /** Target agent receiving the turn. */
      agentId: string;
      /** Request identifier correlated with subsequent planner activity. */
      requestId: string;
      /** Raw user text. */
      text: string;
    }
  | {
      kind: "planning-start";
      /** Agent entering planner loop. */
      agentId: string;
      /** Correlates to the user turn that initiated planning. */
      requestId: string;
    }
  | {
      kind: "step";
      /** Planner-assigned step number (1-based, monotonic within a session). */
      step: number;
      /** Goal statement for this step (schema's 'goal'). */
      goal: string;
      /** Optional natural language phrase for user readability (schema's 'say'). */
      say?: string;
    }
  | {
      kind: "action";
      step: number;
      /** Tool name (must match registered runtime tools). */
      tool: "fs" | "http";
      /** Unique correlation id from the planner's JSON (`toolcall_id`). */
      toolcallId: string;
      /** Raw argument object passed to the tool. */
      args: unknown;
      say?: string;
    }
  | {
      kind: "observation";
      /** Tool that produced this observation. */
      tool: string;
      /** Whether the tool reported success. */
      ok: boolean;
      /** Tool payload (may be truncated upstream for safety). */
      data: string;
    }
  | {
      kind: "deliverable";
      step: number;
      deliverable: {
        kind: DeliverableKind;
        value: string;
        /** Arbitrary metadata the planner might attach (e.g. language, size). */
        meta?: Record<string, unknown>;
        /** Optional narration. */
        say?: string;
      };
    }
  | {
      kind: "final";
      step: number;
      /** High-level summary / conclusion. */
      summary: string;
      /** Final deliverables (spec excludes 'code'; code should appear as intermediate deliverables). */
      deliverables: Array<{
        kind: Exclude<DeliverableKind, "code">;
        value: string;
      }>;
    }
  | {
      kind: "status";
      /** Machine status signal. */
      status: "interrupted" | "max-steps";
      /** Optional detail / explanation. */
      detail?: string;
    }
  | {
      kind: "error";
      /** Phase where the error originated. */
      phase: "llm" | "planner" | "tool" | "runtime";
      /** Human-readable message (already safe to show end users). */
      message: string;
    }
  | {
      kind: "planning-stop";
      /** Agent leaving the planner loop. */
      agentId: string;
      /** Correlates with `planning-start`. */
      requestId: string;
    /** Reason code for stopping. */
    reason: "final" | "error" | "interrupted" | "max-steps";
      /** Optional detail (e.g. forwarded status detail). */
      detail?: string;
    }
  | {
      kind: "llm-start";
      /** Target agent id whose planner initiated model work */
      target: string;
      /** Correlation id for the underlying LLM request */
      requestId: string;
      /** Optional preview of the prompt (truncated upstream) */
      promptPreview?: string;
    }
  | {
      kind: "stream-token";
      /** Target agent id (if multiplexing). */
      target: string;
      /** Incremental token text. */
      token: string;
    }
  | {
      kind: "stream-done";
      target: string;
    }
  | {
      kind: "llm-end";
      /** Target agent id whose planner initiated model work */
      target: string;
      requestId: string;
      /** Total duration in ms as measured by runtime */
      durationMs: number;
      /** Number of streamed text tokens (if known) */
      tokens?: number;
    };

/* -------------------------------------------------------------------------- */
/*  Type Guards                                                               */
/* -------------------------------------------------------------------------- */

export function isStepEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "step" }> {
  return e.kind === "step";
}

export function isSessionStartEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "session-start" }> {
  return e.kind === "session-start";
}

export function isUserTurnEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "user-turn" }> {
  return e.kind === "user-turn";
}

export function isPlanningStartEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "planning-start" }> {
  return e.kind === "planning-start";
}

export function isActionEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "action" }> {
  return e.kind === "action";
}

export function isObservationEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "observation" }> {
  return e.kind === "observation";
}

export function isDeliverableEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "deliverable" }> {
  return e.kind === "deliverable";
}

export function isFinalEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "final" }> {
  return e.kind === "final";
}

export function isStatusEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "status" }> {
  return e.kind === "status";
}

export function isErrorEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "error" }> {
  return e.kind === "error";
}

export function isPlanningStopEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "planning-stop" }> {
  return e.kind === "planning-stop";
}

export function isStreamTokenEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "stream-token" }> {
  return e.kind === "stream-token";
}

export function isStreamDoneEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "stream-done" }> {
  return e.kind === "stream-done";
}

export function isLlmStartEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "llm-start" }> {
  return e.kind === "llm-start";
}

export function isLlmEndEvent(
  e: AgentUiEvent
): e is Extract<AgentUiEvent, { kind: "llm-end" }> {
  return e.kind === "llm-end";
}

/* -------------------------------------------------------------------------- */
/*  Utility (Optional Helpers)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Safe truncation of large payload strings before UI render.
 * (Left here as a helper you can leverage in the CLI or elsewhere.)
 */
export function truncate(value: string, max = 1000): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

/**
 * Exhaustiveness check utility; call in default branch of a switch
 * over AgentUiEvent.kind to surface unhandled variants at compile time.
 */
export function assertNever(x: never, msg = "Unhandled variant"): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}

/* -------------------------------------------------------------------------- */
/*  Example Mapping Doc (not executed)                                        */
/* -------------------------------------------------------------------------- */
/*
switch (evt.kind) {
  case "step":          // dim/gray
  case "action":        // yellow emphasis
  case "observation":   // magenta header + gray body
  case "deliverable":   // icon + style by deliverable.deliverable.kind
  case "final":         // green summary + list
  case "status":        // red or gray
  case "error":         // red
  case "stream-token":  // cyan incremental
  case "stream-done":   // finalize line/prompt
}
*/
