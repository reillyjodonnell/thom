import type { Event } from "./events.js";
export type Tools = "fs" | "http";

export type Effect =
  | { kind: "LlmGenerate"; prompt: string; target: string; reqId?: string }
  | {
      kind: "ToolCall";
      tool: Tools;
      args: unknown;
      target: string;
      reqId?: string;
    };

export type EffectRunner = (
  e: Effect,
  a: {
    sessionId: string;
    signal: AbortSignal;
  }
) => Promise<Event | Event[]>;

// Registry the scheduler/engine can call:
export interface EffectRegistry {
  run(
    effect: Effect,
    args: { sessionId: string; signal: AbortSignal }
  ): Promise<Event | Event[]>;
}
