export interface ToolPort {
  name: string;
  run(args: unknown): Promise<{ ok: boolean; data: string }>;
}
