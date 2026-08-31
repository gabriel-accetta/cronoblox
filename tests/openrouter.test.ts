import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createOpenRouterClient, createRunBudget, runAgentLoop, withIterationCap } from "@cronoblox/agent-core";

describe("OpenRouter agent loop", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the OpenRouter endpoint, credentials, model slug, and tool calling, then resolves via the submit tool", async () => {
    let captured: { url: string; authorization: string | null; title: string | null; body: Record<string, unknown> } | undefined;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      captured = { url: request.url, authorization: request.headers.get("authorization"), title: request.headers.get("x-openrouter-title"), body: (await request.json()) as Record<string, unknown> };
      return new Response(JSON.stringify({
        id: "gen-test", object: "chat.completion", created: 1, model: "openai/gpt-5-mini",
        choices: [{
          index: 0, finish_reason: "tool_calls",
          message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "submit_answer", arguments: JSON.stringify({ breakout_potential: "MODERATE" }) } }] },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, cost: 0.0004 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const client = createOpenRouterClient("sk-or-test");
    const budget = createRunBudget({ maxExternalCalls: 10, maxCostUsd: 10 });
    const { result, iterations } = await runAgentLoop({
      client, model: "openai/gpt-5-mini", reasoningEffort: "low", system: "You are a test agent.", userInput: { game: "Test game" },
      tools: [],
      submit: { name: "submit_answer", description: "Submit your final answer.", schema: z.object({ breakout_potential: z.enum(["LOW", "MODERATE", "HIGH", "VERY HIGH"]) }) },
      budget: withIterationCap(budget, 4, 10),
      signal: new AbortController().signal,
    });

    expect(captured?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured?.authorization).toBe("Bearer sk-or-test");
    expect(captured?.title).toBe("Cronoblox");
    expect(captured?.body.model).toBe("openai/gpt-5-mini");
    expect(captured?.body.reasoning_effort).toBe("low");
    expect(captured?.body.max_tokens).toBe(4096);
    expect(Array.isArray(captured?.body.tools)).toBe(true);
    expect(result.breakout_potential).toBe("MODERATE");
    expect(iterations).toBe(1);
    expect(budget.snapshot().costUsd).toBeCloseTo(0.0004);
  });
});
