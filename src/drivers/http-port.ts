import { ToolPort } from "./tools-port.js";

export class HttpPort implements ToolPort {
  name = "http";
  async run(args: any) {
    try {
      const { url, method = "GET", headers = {}, body } = args ?? {};
      if (!/^https?:\/\//.test(url)) return { ok: false, data: "invalid url" };
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
      });
      const text = await res.text();
      return { ok: res.ok, data: text };
    } catch (e: any) {
      return { ok: false, data: String(e.message ?? e) };
    }
  }
}
