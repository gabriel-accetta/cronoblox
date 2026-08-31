import { PublicToolResultSchema, type PublicToolResult } from "@cronoblox/contracts";
import { executeDataTool, type ToolName } from "./tools";

export class CapacityError extends Error {}

type Execute = (name: ToolName, args: Record<string, unknown>, signal: AbortSignal) => Promise<PublicToolResult>;

/** Hackathon safeguards are intentionally process-local, not a multi-tenant quota system. */
export class PublicToolRuntime {
  private readonly cache = new Map<string, { expires: number; result: PublicToolResult }>();
  private readonly pending = new Map<string, Promise<PublicToolResult>>();
  private windowStart = 0;
  private calls = 0;

  constructor(private readonly options: {
    execute?: Execute; now?: () => number; maxConcurrent?: number; callsPerMinute?: number;
    timeoutMs?: number; cacheTtlMs?: number; maxCacheEntries?: number;
  } = {}) {}

  async call(name: ToolName, args: Record<string, unknown>): Promise<PublicToolResult> {
    const now = (this.options.now ?? Date.now)();
    if (now - this.windowStart >= 60_000) { this.windowStart = now; this.calls = 0; }
    if (++this.calls > (this.options.callsPerMinute ?? 120)) throw new CapacityError("The public demo has reached its tool-call limit. Try again in one minute.");

    const key = JSON.stringify([name, args]);
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    const cached = this.cache.get(key);
    if (cached) return { ...cached.result, cached: true };
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= (this.options.maxConcurrent ?? 4)) throw new CapacityError("The public demo is busy. Try again shortly; do not repeatedly retry.");

    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 25_000);
    const operation = Promise.resolve().then(() => (this.options.execute ?? executeDataTool)(name, args, signal))
      .then((value) => {
        const result = PublicToolResultSchema.parse(value);
        // Bound retained memory as well as the number of keys. Never cache a failed tool call.
        if (JSON.stringify(result).length <= 64_000) {
          if (this.cache.size >= (this.options.maxCacheEntries ?? 128)) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { result, expires: (this.options.now ?? Date.now)() + (this.options.cacheTtlMs ?? 60_000) });
        }
        return result;
      }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }
}
