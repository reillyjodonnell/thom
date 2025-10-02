import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { ToolPort } from "./tools-port.js";

export class FsPort implements ToolPort {
  name = "fs";
  constructor(private root: string) {}
  private safe(p: string) {
    const full = resolve(join(this.root, p));
    if (!full.startsWith(resolve(this.root)))
      throw new Error("path escapes workspace");
    return full;
  }
  async run(args: any) {
    try {
      const { op, path, content } = args ?? {};
      if (op === "read")
        return { ok: true, data: await fs.readFile(this.safe(path), "utf8") };
      if (op === "write") {
        await fs.mkdir(resolve(join(this.root, path, "..")), {
          recursive: true,
        });
        await fs.writeFile(this.safe(path), String(content ?? ""), "utf8");
        return { ok: true, data: "ok" };
      }
      if (op === "append") {
        await fs.appendFile(this.safe(path), String(content ?? ""), "utf8");
        return { ok: true, data: "ok" };
      }
      return { ok: false, data: "unsupported fs op" };
    } catch (e: any) {
      return { ok: false, data: String(e.message ?? e) };
    }
  }
}
