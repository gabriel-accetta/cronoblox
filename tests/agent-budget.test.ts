import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentCallAllowance, createOpenRouterClient, createRunBudget, runAgentLoop, withIterationCap, type AgentEvent, type AgentTool } from "@cronoblox/agent-core";
import { describeToolArgs } from "@cronoblox/agent-tools";
import { BASE_LIMITS, getProfile, reasoningEffortFor } from "@cronoblox/config";

const answer = z.object({ verdict: z.string() });

/** Replies with a scripted sequence of assistant messages, one per model call. */
function stubModel(turns: Array<Array<{ name: string; args: unknown }> | null>, jsonAnswer?: unknown) {
  let call = 0;
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    bodies.push((await request.json()) as Record<string, unknown>);
    const turn = turns[Math.min(call, turns.length - 1)] ?? null;
    call += 1;
    const message = jsonAnswer && bodies.at(-1)?.response_format
      ? { role: "assistant", content: JSON.stringify(jsonAnswer) }
      : turn
      ? { role: "assistant", content: null, tool_calls: turn.map((t, index) => ({ id: `c${call}_${index}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) }
      : { role: "assistant", content: "I will think about it." };
    return new Response(JSON.stringify({ id: "gen", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "tool_calls", message: { ...message, reasoning: "private model reasoning" } }], usage: { cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return bodies;
}

function countingTool(onCall: () => void, fail = false): AgentTool<{ q: string }> {
  return {
    name: "search", description: "Search.", parameters: z.object({ q: z.string() }), externalCalls: 1,
    async execute({ q }) { onCall(); if (fail) throw new Error("Roblox returned 404"); return `results for ${q}`; },
  };
}

async function run(tools: AgentTool[], maxIterations: number, maxExternalCalls: number, events: AgentEvent[] = []) {
  return runAgentLoop({
    client: createOpenRouterClient("sk-or-test"), model: "m", system: "s", userInput: {}, tools,
    submit: { name: "submit", description: "Submit.", schema: answer },
    budget: withIterationCap(createRunBudget({ maxExternalCalls: 100, maxCostUsd: 10 }), maxIterations, maxExternalCalls),
    signal: new AbortController().signal,
    onEvent: (event) => { events.push(event); },
  });
}

describe("agent loop budget enforcement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses tool calls once the loop is forced to conclude, instead of executing them anyway", async () => {
    let executed = 0;
    // The model ignores forced tool_choice and keeps calling `search` on every turn, then finally submits.
    const bodies = stubModel([
      [{ name: "search", args: { q: "a" } }],
      [{ name: "search", args: { q: "b" } }],
      [{ name: "search", args: { q: "c" } }],
      [{ name: "submit", args: { verdict: "done" } }],
    ], { verdict: "done" });
    const events: AgentEvent[] = [];
    const { result } = await run([countingTool(() => { executed += 1; })], 2, 10, events);

    expect(result.verdict).toBe("done");
    // Iteration 1 runs a real search; from iteration 2 the loop is forced and must refuse the rest.
    expect(executed).toBe(1);
    expect(bodies).toHaveLength(3); // one research turn, one forced turn, one JSON recovery
    expect(bodies.at(-1)?.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(bodies[1]?.messages)).toContain("Research is closed");
    const terminalMessages = bodies.at(-1)?.messages as Array<{ role: string }>;
    expect(terminalMessages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(JSON.stringify(terminalMessages)).toContain("results for a");
    expect(JSON.stringify(terminalMessages)).not.toContain("private model reasoning");
    expect(events.filter((event) => event.type === "tool_refused")).not.toHaveLength(0);
    expect(events.find((event) => event.type === "tool_refused")?.reason).toMatch(/model turn limit reached/);
  });

  it("stops spending once the loop's own external-call allowance is gone", async () => {
    let executed = 0;
    stubModel([
      [{ name: "search", args: { q: "a" } }, { name: "search", args: { q: "b" } }, { name: "search", args: { q: "c" } }],
      [{ name: "submit", args: { verdict: "done" } }],
    ]);
    const events: AgentEvent[] = [];
    await run([countingTool(() => { executed += 1; })], 8, 2, events);
    expect(executed).toBe(2);
    expect(events.find((event) => event.type === "tool_refused")?.reason).toMatch(/agent tool-call allowance reached/);
  });

  it("serves a repeated identical tool call from cache without spending the allowance", async () => {
    let executed = 0;
    stubModel([
      [{ name: "search", args: { q: "same" } }, { name: "search", args: { q: "same" } }, { name: "search", args: { q: "same" } }],
      [{ name: "submit", args: { verdict: "done" } }],
    ]);
    await run([countingTool(() => { executed += 1; })], 8, 10);
    expect(executed).toBe(1);
  });

  it("disables a tool that keeps failing rather than retrying it forever", async () => {
    let executed = 0;
    stubModel([
      [{ name: "search", args: { q: "a" } }],
      [{ name: "search", args: { q: "b" } }],
      [{ name: "search", args: { q: "c" } }],
      [{ name: "search", args: { q: "d" } }],
      [{ name: "submit", args: { verdict: "done" } }],
    ]);
    await run([countingTool(() => { executed += 1; }, true)], 8, 10);
    expect(executed).toBe(2);
  });

  it("charges failed external attempts and refuses further calls when the allowance is spent", async () => {
    let executed = 0;
    stubModel([
      [{ name: "search", args: { q: "a" } }, { name: "search", args: { q: "b" } }],
      [{ name: "submit", args: { verdict: "source unavailable" } }],
    ]);
    const events: AgentEvent[] = [];
    await run([countingTool(() => { executed += 1; }, true)], 8, 1, events);
    expect(executed).toBe(1);
    expect(events.some((event) => event.type === "tool_refused" && event.reason.includes("1/1"))).toBe(true);
  });

  it("salvages a structured answer when the model never calls the submit tool", async () => {
    let call = 0;
    vi.stubGlobal("fetch", async () => {
      call += 1;
      // Every tool-calling turn returns prose; only the final plain-JSON request yields the answer.
      const message = call > 2 ? { role: "assistant", content: '{"verdict":"salvaged"}' } : { role: "assistant", content: "thinking" };
      return new Response(JSON.stringify({ id: "g", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message }], usage: { cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const { result, degraded } = await run([], 2, 10);
    expect(result.verdict).toBe("salvaged");
    expect(degraded).toBe(true);
    expect(call).toBe(3);
  });

  it("splits the run allowance so a later agent still has calls left", () => {
    const profile = { limits: { max_external_calls: 18 } };
    const research = agentCallAllowance(profile, "research");
    const verify = agentCallAllowance(profile, "verify");
    expect(research * 2 + agentCallAllowance(profile, "delegate") + verify).toBeLessThanOrEqual(18);
    expect(verify).toBeGreaterThanOrEqual(2);
  });
});

describe("effort scaling", () => {
  it("uses supported explicit DeepSeek V4 reasoning instead of defaulting medium audits to high", () => {
    expect(reasoningEffortFor("deepseek/deepseek-v4-flash-0731", "medium")).toBe("low");
    expect(reasoningEffortFor("deepseek/deepseek-v4-flash-0731", "low")).toBe("low");
    expect(reasoningEffortFor("deepseek/deepseek-v4-flash-0731", "high")).toBe("high");
    expect(reasoningEffortFor("another/model", "medium")).toBeUndefined();
  });
  it("shrinks every work dimension at low effort and never raises the cost ceiling", () => {
    const low = getProfile("full", "low");
    const medium = getProfile("full", "medium");
    const high = getProfile("full", "high");

    expect(low.limits.max_external_calls).toBeLessThan(medium.limits.max_external_calls);
    expect(low.limits.max_search_results).toBeLessThan(medium.limits.max_search_results);
    expect(low.limits.max_critic_cycles).toBe(0);
    expect(high.limits.max_external_calls).toBeGreaterThan(medium.limits.max_external_calls);
    expect(high.limits.max_search_results).toBeGreaterThan(medium.limits.max_search_results);

    // Effort buys more work inside the ceiling, never a bigger ceiling.
    for (const profile of [low, medium, high]) expect(profile.limits.max_cost_usd).toBeLessThanOrEqual(BASE_LIMITS.max_cost_usd);
    expect(low.limits.max_cost_usd).toBeLessThan(medium.limits.max_cost_usd);
    expect(high.limits.max_cost_usd).toBe(medium.limits.max_cost_usd);
  });

  it("keeps a profile's own tighter limits from being loosened by effort", () => {
    // baseline caps critic cycles at 0 and calls at 6; high effort must not override that intent.
    const baseline = getProfile("baseline", "high");
    expect(baseline.limits.max_critic_cycles).toBe(0);
    expect(baseline.limits.max_external_calls).toBeLessThan(getProfile("full", "high").limits.max_external_calls);
  });
});

describe("trajectory detail", () => {
  it("gives every tool call a distinguishing preview", () => {
    expect(describeToolArgs({ query: "bloodlines roblox review" })).toBe("bloodlines roblox review");
    expect(describeToolArgs({ url: "https://example.com/a", reason: "verify view count" })).toContain("https://example.com/a");
    expect(describeToolArgs({ focus: "compare CCU against similar RPGs" })).toBe("compare CCU against similar RPGs");
    expect(describeToolArgs({})).toBeNull();
  });

  it("truncates a long preview instead of flooding the timeline", () => {
    const detail = describeToolArgs({ query: "x".repeat(400) });
    expect(detail).not.toBeNull();
    expect(detail!.length).toBeLessThanOrEqual(120);
    expect(detail!.endsWith("…")).toBe(true);
  });
});
