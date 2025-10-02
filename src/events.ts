export type Event =
  | { type: "START"; sessionId: string }
  | { type: "TokenChunk"; text: string; target: string; reqId: string }
  | { type: "LlmComplete"; target: string; reqId: string }
  | { type: "LlmCanceled"; target: string; reqId: string }
  | { type: "LlmError"; error: string; target: string; reqId: string }
  | { type: "UserInput"; text: string; target: string; reqId: string }
  | {
      type: "ToolResult";
      target: string;
      tool: string;
      reqId?: string;
      ok: boolean;
      data: string;
    };
