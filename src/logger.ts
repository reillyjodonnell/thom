/*
{
  "ts": 16960123,
  "actorId": "chat-1",
  "event": { "type": "MessageReceived", "payload": { "text": "hi" } },
  "newState": { "unread": 1 }
}
*/
import { writeFile, appendFile } from "node:fs/promises";

export type Message = {
  ts: number;
  actorId: string;
  event: {
    type: string;
    payload: {
      text: string;
    };
  };
  newState: {
    unread: number;
  };
};

export class Logger {
  private fileName: string;
  constructor(fileName: string) {
    this.fileName = fileName;
  }

  log(message: Message) {
    // write to fileName
    console.log(`\n[LOG] ${JSON.stringify(message)}\n`);
  }

  error(message: string) {
    console.error(`\n[ERROR] ${message}\n`);
  }

  warn(message: string) {
    console.warn(`\n[WARN] ${message}\n`);
  }

  async append(entry: unknown): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    try {
      await appendFile(this.fileName, line, "utf8");
    } catch (err: any) {
      // fallback: if file doesn’t exist, create it
      if (err.code === "ENOENT") {
        await writeFile(this.fileName, line, "utf8");
      } else {
        console.error("[logger] failed to append:", err);
      }
    }
  }
}
