// drivers/openai-port.ts
import { Logger } from "../logger.js";

export interface LlmPort {
  generate(
    prompt: string,
    opts?: { signal?: AbortSignal }
  ): AsyncIterable<string>;
}

// drivers/openai-port.ts
export class OpenAIResponsesPort implements LlmPort {
  constructor(
    private apiKey: string,
    private baseUrl = "https://api.openai.com/v1",
    private model = "gpt-5-mini",
    private logger?: Logger
  ) {}

  private _log(entry: any) {
    if (this.logger && typeof (this.logger as any).append === "function") {
      (this.logger as any)
        .append({ ts: Date.now(), kind: "openai", ...entry })
        .catch(() => {});
    } else {
      try {
        console.debug("[openai-port]", entry);
      } catch {}
    }
  }

  async *generate(
    prompt: string,
    opts?: { signal?: AbortSignal }
  ): AsyncIterable<string> {
    const startedAt = Date.now();
    const requestId =
      "openai-" +
      startedAt.toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8);
    this._log({
      phase: "start",
      requestId,
      model: this.model,
      promptPreview: prompt.slice(0, 120),
    });

    let tokenCount = 0;
    try {
      const res = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: this.model,
          // simple string input works with Responses API
          input: prompt,
          stream: true,
        }),
        signal: opts?.signal ?? null,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        const err = new Error(
          `OpenAI HTTP ${res.status}${detail ? `: ${detail}` : ""}`
        );
        this._log({ phase: "error", requestId, message: err.message });
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          for (const rawLine of frame.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              this._log({
                phase: "end",
                requestId,
                durationMs: Date.now() - startedAt,
                tokens: tokenCount,
              });
              return;
            }

            let evt: any;
            try {
              evt = JSON.parse(data);
            } catch {
              continue;
            }

            // ----- handle provider errors early -----
            if (evt?.type === "error" && evt?.error?.message) {
              const errMsg = `${evt.error.code ?? "error"}: ${
                evt.error.message
              }`;
              this._log({ phase: "error", requestId, message: errMsg });
              throw new Error(errMsg);
            }
            if (
              evt?.type === "response.failed" &&
              evt?.response?.error?.message
            ) {
              const e = evt.response.error;
              const errMsg = `${e.code ?? "failed"}: ${e.message}`;
              this._log({ phase: "error", requestId, message: errMsg });
              throw new Error(errMsg);
            }

            // ----- try to extract text deltas -----
            // 1) canonical: response.output_text.delta
            if (
              evt?.type === "response.output_text.delta" &&
              typeof evt?.delta === "string"
            ) {
              tokenCount++;
              yield evt.delta;
              continue;
            }
            // 2) sometimes: { type: "...", delta: { text: "..." } }
            if (evt?.delta && typeof evt.delta.text === "string") {
              tokenCount++;
              yield evt.delta.text;
              continue;
            }
            // 3) occasionally: { output_text: ["..."] }
            if (
              Array.isArray(evt?.output_text) &&
              typeof evt.output_text[0] === "string"
            ) {
              tokenCount++;
              yield evt.output_text[0];
              continue;
            }
            // 4) chat-compat fallback
            const compat = evt?.choices?.[0]?.delta?.content;
            if (typeof compat === "string" && compat) {
              tokenCount++;
              yield compat;
              continue;
            }

            // otherwise, ignore lifecycle frames like response.created/in_progress
            // console.debug("[openai-port] unparsed frame:", evt);
          }
        }
      }

      // If stream ended without explicit [DONE]
      this._log({
        phase: "end",
        requestId,
        durationMs: Date.now() - startedAt,
        tokens: tokenCount,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        this._log({
          phase: "error",
          requestId,
          aborted: true,
          durationMs: Date.now() - startedAt,
        });
      } else {
        this._log({
          phase: "error",
          requestId,
          message: e?.message || String(e),
          durationMs: Date.now() - startedAt,
        });
      }
      throw e;
    }
  }
}
