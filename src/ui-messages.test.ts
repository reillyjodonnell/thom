import { describe, expect, test } from "bun:test";
import { AGENT_UI_EVENT_KINDS } from "./ui-messages.js";

const EXPECTED_KINDS = [
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

describe("AGENT_UI_EVENT_KINDS", () => {
  test("matches the documented lifecycle order", () => {
    expect(AGENT_UI_EVENT_KINDS).toEqual(EXPECTED_KINDS);
  });

  test("contains only unique entries", () => {
    expect(new Set(AGENT_UI_EVENT_KINDS).size).toBe(
      AGENT_UI_EVENT_KINDS.length
    );
  });
});
