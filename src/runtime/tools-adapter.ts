// runtime/tools-adapter.ts

import { ToolPort } from "../drivers/tools-port.js";
import { Effect } from "../effect.js";
import { Event } from "../events.js";
import { Scheduler } from "../scheduler.js";

export class ToolsAdapter {
  private registry = new Map<string, ToolPort>();
  constructor(
    private scheduler: Scheduler,
    private dispatch: (e: Event) => void
  ) {}
  register(port: ToolPort) {
    this.registry.set(port.name, port);
  }
  submit(eff: Effect) {
    if (eff.kind !== "ToolCall") return;
    const tool = this.registry.get(eff.tool);
    if (!tool) {
      this.dispatch({
        type: "ToolResult",
        target: eff.target,
        tool: eff.tool,
        ok: false,
        data: "unknown tool",
      });
      return;
    }
    this.scheduler.enqueue({
      task: {
        id: `tool-${eff.tool}-${Date.now()}`,
        run: async () => {
          const out = await tool.run(eff.args);
          this.dispatch({
            type: "ToolResult",
            target: eff.target,
            tool: eff.tool,
            ok: out.ok,
            data: out.data,
          });
        },
      },
      lane: "domain",
      priority: "medium",
    });
  }
}
