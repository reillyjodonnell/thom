/**
 * Minimal type declarations for the experimental `bun:readline` import used in this project.
 *
 * This is NOT an exhaustive implementation of Node's `readline` module; it only
 * covers what the current CLI code relies on: `createInterface`, `.prompt()`,
 * and `.on("line" | "close")`.
 *
 * Extend as needed if more features are used later.
 */

declare module "bun:readline" {
  import { Readable, Writable } from "node:stream";

  export interface CreateInterfaceOptions {
    input: NodeJS.ReadableStream | Readable;
    output?: NodeJS.WritableStream | Writable;
    prompt?: string;
  }

  export interface ReadlineInterface {
    /**
     * Display the current prompt (optionally with a custom one).
     */
    prompt(preserveCursor?: boolean): void;

    /**
     * Close the interface (emits 'close').
     */
    close(): void;

    /**
     * Event listener registrations.
     */
    on(event: "line", listener: (line: string) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  /**
   * Create a readline-like interface bound to the given input/output streams.
   */
  export function createInterface(
    options: CreateInterfaceOptions
  ): ReadlineInterface;
}
