import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentModelError, createOpenRouterClient, createRunBudget, runAgentLoop, withIterationCap, type AgentEvent } from "@cronoblox/agent-core";

const submit = { name: "submit", description: "Submit.", schema: z.object({ verdict: z.string() }) };
const reply = (message: unknown) => new Response(JSON.stringify({ id: "g", object: "chat.completion", created: 1, model: "test-model", choices: [{ index: 0, finish_reason: "stop", message }], usage: { prompt_tokens: 12, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 3 }, cost: 0.001 } }), { headers: { "content-type": "application/json" } });
function run(options: { signal?: AbortSignal; recoverOnModelError?: boolean; events?: AgentEvent[]; requestTimeoutMs?: number } = {}) {
  return runAgentLoop({ client: createOpenRouterClient("test-key"), model: "test-model", system: "test", userInput: {}, tools: [], submit,
    budget: withIterationCap(createRunBudget({ maxExternalCalls: 6, maxCostUsd: 0.2 }), 4, 6),
    signal: options.signal ?? new AbortController().signal, requestTimeoutMs: options.requestTimeoutMs ?? 25,
    recoverOnModelError: options.recoverOnModelError, onEvent: (event) => { options.events?.push(event); } });
}

function stalledFetch() {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
}

describe("bounded, observable model requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies an individual timeout and does not hide SDK retries", async () => {
    const fetch = stalledFetch(); vi.stubGlobal("fetch", fetch);
    const events: AgentEvent[] = [];
    await expect(run({ recoverOnModelError: false, events })).rejects.toMatchObject({ name: "AgentModelError", kind: "timeout", message: expect.stringContaining("test-model") });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["llm_call", "llm_error"]);
    expect(events.at(-1)).toMatchObject({ iteration: 1, durationMs: expect.any(Number) });
  });

  it("can recover a required answer once as schema-validated JSON after a timeout", async () => {
    const stalled = stalledFetch();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(await new Request(input, init).json() as Record<string, unknown>);
      return bodies.length === 1 ? stalled(input, init) : reply({ role: "assistant", content: '{"verdict":"recovered"}' });
    });
    const result = await run();
    expect(result).toMatchObject({ result: { verdict: "recovered" }, degraded: true, iterations: 2 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(bodies[1]?.messages)).toContain("Required JSON schema");
  });

  it("does not recover or swallow a run deadline/cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("Run exceeded its runtime budget");
    const fetch = stalledFetch(); vi.stubGlobal("fetch", fetch);
    const promise = run({ signal: controller.signal, requestTimeoutMs: 1_000 });
    const check = expect(promise).rejects.toBe(reason);
    controller.abort(reason);
    await check;
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("bounds response-body reading too, not only time to response headers", async () => {
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException("This operation was aborted", "AbortError")), { once: true }); },
    }), { headers: { "content-type": "application/json" } }));
    await expect(run({ recoverOnModelError: false })).rejects.toBeInstanceOf(AgentModelError);
  });

  it("records model latency and token counts without model reasoning text", async () => {
    vi.stubGlobal("fetch", async () => reply({ role: "assistant", content: null, reasoning: "private text", tool_calls: [{ id: "c1", type: "function", function: { name: "submit", arguments: '{"verdict":"done"}' } }] }));
    const events: AgentEvent[] = [];
    await run({ events });
    expect(events.find((event) => event.type === "llm_result")).toMatchObject({ promptTokens: 12, completionTokens: 8, reasoningTokens: 3, durationMs: expect.any(Number) });
    expect(JSON.stringify(events)).not.toContain("private text");
  });

  it("classifies transient HTTP failures but does not disguise credential errors", async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"busy"}}', { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(run({ recoverOnModelError: false })).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 }));
    await expect(run()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
