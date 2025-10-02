//!/usr/bin/env bun
// src/cli.ts
import { createInterface } from "bun:readline";
import { Runtime } from "./runtime.js";
import { assertNever, type AgentUiEvent } from "./ui-messages.js";

/* -------------------------------------------------------------------------- */
/*  ANSI Styling Utilities                                                    */
/* -------------------------------------------------------------------------- */

const styles = {
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  bgGray: "\x1b[100m",
  reset: "\x1b[0m",
};

function hyperlink(url: string, text?: string): string {
  const display = text || url;
  return `${styles.blue}${styles.underline}\x1b]8;;${url}\x1b\\${display}\x1b]8;;\x1b\\${styles.reset}`;
}

function filePath(p: string): string {
  return `${styles.underline}${p}${styles.reset}`;
}

function inlineCode(code: string): string {
  return `${styles.bgGray}${styles.white} ${code} ${styles.reset}`;
}

function blockCode(code: string): string {
  return code
    .split("\n")
    .map(
      (line) =>
        `${styles.dim}│${styles.reset} ${styles.yellow}${line}${styles.reset}`
    )
    .join("\n");
}

function sectionHeader(text: string): string {
  return `${styles.bold}${styles.green}${text}${styles.reset}`;
}

function errLine(text: string): string {
  return `${styles.yellow}⚠ ${styles.reset}${text}`;
}

/* -------------------------------------------------------------------------- */

const CLEAR = "\x1b[2K";
const CR = "\r";
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

/* Spinner + Prompt State */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: any = null;
let spinnerIdx = 0;
let spinnerActive = false;
let awaitingUserInput = true; // show prompt initially
let planningActive = false; // true while agent doing internal LLM loops

function startSpinner() {
  if (spinnerActive) return;
  spinnerActive = true;
  process.stdout.write(HIDE);
  spinnerTimer = setInterval(() => {
    const frame = SPINNER_FRAMES[spinnerIdx++ % SPINNER_FRAMES.length];
    process.stdout.write(
      CLEAR + CR + styles.cyan + `${frame} thinking...` + styles.reset
    );
  }, 80);
}

function stopSpinner() {
  if (!spinnerActive) return;
  clearInterval(spinnerTimer);
  spinnerTimer = null;
  spinnerActive = false;
  process.stdout.write(CLEAR + CR + SHOW);
}

function showPrompt() {
  if (!awaitingUserInput) return;
  process.stdout.write(SHOW + "> ");
}

/*
const inflight = { llm: new Set<string>(), tool: new Set<string>() };
const turnState = new Map<string, "planning"|"waiting_tool"|"final"|"error">();

function recomputeUi() {
  const busy = inflight.llm.size || inflight.tool.size;
  if (busy) startSpinner(); else stopSpinner();
  const allDone = !busy && [...turnState.values()].every(s => s === "final" || s === "error");
  awaitingUserInput = !!allDone;
}

const onUi = (evt: AgentUiEvent) => {
  switch (evt.kind) {
  ...
  }

  recomputeUi();
}

*/

/**
 * Render semantic events to (unstyled or partially styled) logical lines.
 * Styling that depends purely on kind/kind+content is applied here; per-line
 * color decisions still happen later so we can centralize theme choices.
 */
function renderAgentUiEvent(evt: AgentUiEvent): string[] {
  switch (evt.kind) {
    case "session-start":
      return [
        sectionHeader(
          `session ${evt.sessionId} ready (agent ${evt.agentId})`
        ),
      ];
    case "user-turn":
      return [];
    case "planning-start":
      return [];
    case "planning-stop": {
      const reason =
        evt.reason === "final"
          ? "complete"
          : evt.reason === "error"
          ? "errored"
          : evt.reason === "interrupted"
          ? "interrupted"
          : "max steps";
      const detail = evt.detail ? ` – ${evt.detail}` : "";
      return [`[planning ${reason}]${detail}`.trim()];
    }
    case "step":
      return [`Step ${evt.step}: ${evt.say ?? evt.goal}`];

    case "action": {
      let argsStr = "";
      try {
        argsStr = JSON.stringify(evt.args);
      } catch {
        argsStr = String(evt.args);
      }
      // highlight path field inside fs args if present
      if (
        evt.tool === "fs" &&
        typeof evt.args === "object" &&
        evt.args &&
        "path" in (evt.args as any)
      ) {
        const raw = evt.args as any;
        const highlighted = { ...raw, path: filePath(String(raw.path)) };
        try {
          argsStr = JSON.stringify(highlighted);
        } catch {
          /* ignore */
        }
      }
      return [`Action (step ${evt.step}) -> ${evt.tool} ${argsStr}`];
    }

    case "observation": {
      // not emitting observation lines for now (minimize noise)
      return [];
    }

    case "deliverable": {
      const d = evt.deliverable;
      if (d.kind === "path") return [filePath(d.value)];
      if (d.kind === "url") return [hyperlink(d.value)];
      if (d.kind === "code") {
        return d.value.includes("\n")
          ? [blockCode(d.value)]
          : [inlineCode(d.value)];
      }
      // text
      return [d.value];
    }

    case "final": {
      const lines = [
        evt.summary,
        ...evt.deliverables.map((d) => {
          if (d.kind === "path") return filePath(d.value);
          if (d.kind === "url") return hyperlink(d.value);
          return d.value;
        }),
      ];
      return lines;
    }

    case "status":
      return [
        evt.status === "interrupted"
          ? "[interrupted]"
          : evt.status === "max-steps"
          ? "[max steps reached]"
          : `[status: ${evt.status}]`,
      ];

    case "error":
      return [`[${evt.phase} error] ${evt.message}`];

    case "stream-token":
      return [evt.token];

    case "stream-done":
      return [];

    case "llm-start":
    case "llm-end":
      return [];
  }

  return [];
}

function makeUI(prompt = "> ") {
  let streaming = false;

  return {
    // streaming updates (single line)
    streamUpdate(text: string) {
      if (!streaming) {
        streaming = true;
        // stop spinner if tokens start
        stopSpinner();
        process.stdout.write(HIDE);
      }
      process.stdout.write(CLEAR + CR + styles.cyan + text + styles.reset);
    },
    streamDone() {
      if (streaming) {
        streaming = false;
        process.stdout.write("\n");
      }
    },
    log(line: string) {
      // Ensure spinner does not overwrite logs
      if (spinnerActive) {
        // move spinner to next line before logging
        process.stdout.write(CLEAR + CR);
      }
      console.log(line);
    },
  };
}

const ui = makeUI("> ");

const rt = await Runtime.init((evt: AgentUiEvent) => {

  const lines = renderAgentUiEvent(evt);

  if (evt.kind === "stream-token") {
    ui.streamUpdate(lines.join(""));
    return;
  }
  if (evt.kind === "stream-done") {
    stopSpinner();
    ui.streamDone();
    return;
  }

  // Ensure we are not mid-stream
  ui.streamDone();

  for (const line of lines) {
    if (!line) continue;
    let out = line;

    switch (evt.kind) {
      case "step":
        out = `${styles.gray}${out}${styles.reset}`;
        break;
      case "action":
        out = `${styles.yellow}${out}${styles.reset}`;
        break;
      case "observation":
        out = `${styles.gray}${out}${styles.reset}`;
        break;
      case "deliverable":
        if (!/\x1b\[\d/.test(out) && !out.startsWith("│")) {
          out = `${styles.white}${out}${styles.reset}`;
        }
        break;
      case "final":
        out = `${styles.bold}${out}${styles.reset}`;
        break;
      case "status":
        out = `${styles.red}${out}${styles.reset}`;
        break;
      case "error":
        out = errLine(out);
        break;
      case "planning-stop":
        out = `${styles.cyan}${out}${styles.reset}`;
        break;
    }

    ui.log(out);
  }

  if (awaitingUserInput && !planningActive && !spinnerActive) {
    showPrompt();
  }
});

// auto-start runtime
rt.start();

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

console.log(sectionHeader("commands: say <text> | stop | quit"));
showPrompt();

rl.on("line", (line: string) => {
  const [cmd, ...rest] = line.trim().split(" ");
  if (cmd === "say") {
    const text = rest.join(" ").trim();
    awaitingUserInput = false;
    planningActive = true;
    stopSpinner();
    startSpinner();
    rt.dispatch({
      type: "UserInput",
      text,
      target: "agent#1",
      reqId: `user-${Date.now()}`,
    });
  } else if (cmd === "interrupt") {
    rt.interrupt("agent#1");
  } else if (cmd === "stop") {
    rt.stop();
  } else if (cmd === "quit" || cmd === "exit") {
    rt.stop();
    rl.close();
    return;
  } else {
    console.log(errLine("unknown. use: say | interrupt | stop | quit"));
  }
  // Do not prompt immediately; wait for planner to finish (final/status/error)
}).on("close", () => {
  stopSpinner();
  process.stdout.write(SHOW);
  process.exit(0);
});
