import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterAnalyst } from "@cronoblox/llm";

describe("OpenRouter analyst", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the OpenRouter endpoint, credentials, model slug, and structured output", async () => {
    let captured: { url: string; authorization: string | null; title: string | null; body: Record<string, unknown> } | undefined;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      captured = {
        url: request.url,
        authorization: request.headers.get("authorization"),
        title: request.headers.get("x-openrouter-title"),
        body: await request.json() as Record<string, unknown>,
      };
      return new Response(JSON.stringify({
        id: "gen-test",
        object: "chat.completion",
        created: 1,
        model: "openai/gpt-5-mini",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              breakout_potential: "MODERATE",
              confidence: "LOW",
              recommendation: "Collect more evidence.",
              supporting_claims: [],
              risk_claims: [],
            }),
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await new OpenRouterAnalyst("openai/gpt-5-mini", "sk-or-test").createThesis({
      game: { name: "Test game" },
      evidence: [],
      mode: "developer",
      baseline: true,
    });

    expect(captured?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured?.authorization).toBe("Bearer sk-or-test");
    expect(captured?.title).toBe("Cronoblox");
    expect(captured?.body.model).toBe("openai/gpt-5-mini");
    expect(captured?.body.response_format).toMatchObject({ type: "json_schema" });
    expect(result.thesis.breakout_potential).toBe("MODERATE");
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 7, estimated_cost_usd: 0 });
    expect(result.metadata.provider).toBe("openrouter");
  });
});
