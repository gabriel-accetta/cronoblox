import type OpenAI from "openai";
import { zodFunction } from "openai/helpers/zod";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ZodType } from "zod";
import { AgentModelError, requestModel } from "./request";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools of differing arg shapes must coexist in one array; `any` here (not `unknown`) avoids contravariant-parameter assignability errors at every call site.
export interface AgentTool<A = any> {
  name: string;
  description: string;
  parameters: ZodType<A>;
  /** How many "external calls" this tool counts against the run budget. Defaults to 1. */
  externalCalls?: number;
  execute: (args: A) => Promise<string>;
}

export interface AgentBudget {
  maxIterations: number;
  /** This loop's own share of external calls, so one agent cannot starve the ones that run after it. */
  maxExternalCalls: number;
  /** Records spend and returns whether the run-wide budget still has room. */
  spend(externalCalls: number, costUsd: number): boolean;
  exhausted(): boolean;
  /** Explains which run-wide budget dimension is exhausted, if any. */
  exhaustionReason(): string | null;
}

export type AgentEvent =
  | { type: "llm_call"; iteration: number; forced: boolean; forcedReason?: string }
  | { type: "llm_result"; iteration: number; durationMs: number; promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null }
  | { type: "llm_error"; iteration: number; durationMs: number; detail: string }
  | { type: "tool_call"; iteration: number; name: string; args: unknown }
  | { type: "tool_result"; iteration: number; name: string; durationMs: number }
  | { type: "tool_error"; iteration: number; name: string; detail: string }
  | { type: "tool_refused"; iteration: number; name: string; reason: string }
  | { type: "submit"; iteration: number }
  | { type: "nudge"; iteration: number };

export interface AgentLoopResult<R> {
  result: R;
  iterations: number;
  toolCallCount: number;
  /** True when the structured answer came from the plain-JSON fallback rather than a tool call. */
  degraded: boolean;
}

/** Identical (tool, arguments) pairs are answered from this turn's cache — models re-issue the same lookup constantly. */
const cacheKey = (name: string, args: unknown) => `${name}:${JSON.stringify(args, Object.keys(args as object ?? {}).sort())}`;

/** After this many consecutive failures a tool is treated as broken for the rest of the loop. */
const TOOL_FAILURE_LIMIT = 2;
/** Ceiling on one model call, so a stuck request cannot consume the whole run deadline. */
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
/** Includes reasoning tokens on OpenRouter: an unconstrained completion can outlive the deadline. */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * A hand-rolled tool-calling agent loop: call the model, execute whatever tools it asks
 * for, feed results back, repeat until it calls the designated `submit` tool. Domain-agnostic —
 * callers supply tools, a submit schema, and a budget; this file knows nothing about Cronoblox.
 */
export async function runAgentLoop<R>(options: {
  client: OpenAI;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  system: string;
  userInput: unknown;
  tools: AgentTool[];
  submit: { name: string; description: string; schema: ZodType<R> };
  budget: AgentBudget;
  /** Aborts an in-flight model call once the run's overall deadline (max_runtime_ms) fires — without this, a slow/stuck LLM call ignores the run budget entirely. */
  signal: AbortSignal;
  requestTimeoutMs?: number;
  /** Optional verification can fail visibly instead of spending another model call on recovery. */
  recoverOnModelError?: boolean;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}): Promise<AgentLoopResult<R>> {
  const { client, model, system, userInput, tools, submit, budget, signal, onEvent } = options;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  signal.throwIfAborted();
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const toolDefs: ChatCompletionTool[] = tools.map((tool) => zodFunction({ name: tool.name, parameters: tool.parameters, description: tool.description }));
  const submitDef: ChatCompletionTool = zodFunction({ name: submit.name, parameters: submit.schema, description: submit.description });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(userInput) },
  ];

  let toolCallCount = 0;
  let localExternalCalls = 0;
  let lastSubmitError: string | null = null;
  let refusedWhileForced = 0;
  const resultCache = new Map<string, string>();
  const consecutiveFailures = new Map<string, number>();
  // At most one correction of an invalid final submission; ignored tool_choice goes straight
  // to the bounded JSON fallback, not three more expensive requests with the same instructions.
  const hardCap = budget.maxIterations + 1;
  let iterations = 0;
  let modelError: AgentModelError | undefined;
  const callsSpent = () => budget.exhausted() || localExternalCalls >= budget.maxExternalCalls;
  const forcedReason = () => budget.exhaustionReason()
    ?? (localExternalCalls >= budget.maxExternalCalls ? `agent tool-call allowance reached (${localExternalCalls}/${budget.maxExternalCalls} calls)` : `model turn limit reached (${budget.maxIterations} turns)`);

  for (let iteration = 1; iteration <= hardCap; iteration += 1) {
    signal.throwIfAborted();
    iterations = iteration;
    const forceSubmit = callsSpent() || iteration >= budget.maxIterations;
    if (lastSubmitError) {
      messages.push({ role: "user", content: `Your last ${submit.name} call was invalid: ${lastSubmitError}. Call ${submit.name} again with corrected arguments.` });
      lastSubmitError = null;
    }

    if (forceSubmit) messages.push({ role: "user", content: `Research is closed: ${forcedReason()}. Do not request more research. Call ${submit.name} now, using only the evidence already available and explicitly noting gaps.` });
    await onEvent?.({ type: "llm_call", iteration, forced: forceSubmit, ...(forceSubmit ? { forcedReason: forcedReason() } : {}) });
    let response;
    try {
      response = await requestModel({ client, body: {
        model, messages, max_tokens: MAX_OUTPUT_TOKENS, ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}), tools: forceSubmit ? [submitDef] : [...toolDefs, submitDef],
        tool_choice: forceSubmit ? { type: "function", function: { name: submit.name } } : "auto",
      }, signal, timeoutMs: requestTimeoutMs, iteration, onEvent });
    } catch (error) {
      if (!(error instanceof AgentModelError) || options.recoverOnModelError === false) throw error;
      modelError = error;
      break;
    }
    const cost = (response.usage as { cost?: number } | undefined)?.cost ?? 0;
    budget.spend(0, cost);

    const message = response.choices[0]?.message;
    if (!message) throw new AgentModelError("invalid_response", "Agent loop received no message from the model");
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      messages.push({ role: "user", content: `Call a tool, or call ${submit.name} with your final structured answer.` });
      await onEvent?.({ type: "nudge", iteration });
      if (forceSubmit) break;
      continue;
    }

    let submitted: R | null = null;
    for (const call of calls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: unknown;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }

      if (name === submit.name) {
        const parsed = submit.schema.safeParse(args);
        if (!parsed.success) {
          lastSubmitError = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
          messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid: ${lastSubmitError}` });
          continue;
        }
        submitted = parsed.data;
        await onEvent?.({ type: "submit", iteration });
        messages.push({ role: "tool", tool_call_id: call.id, content: "Recorded." });
        continue;
      }

      // Models keep calling tools that were withdrawn from `tools` this turn. Offering them is not
      // enough — the loop has to refuse, or the budget cap means nothing and the loop never ends.
      if (forceSubmit) {
        refusedWhileForced += 1;
        const reason = forcedReason();
        await onEvent?.({ type: "tool_refused", iteration, name, reason });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Research is closed for this task because the ${reason}. Call ${submit.name} now with your conclusion based on what you already have.` });
        continue;
      }

      const tool = toolMap.get(name);
      if (!tool) { messages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` }); continue; }
      const parsedArgs = tool.parameters.safeParse(args);
      if (!parsedArgs.success) { messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid arguments: ${parsedArgs.error.message}` }); continue; }

      const key = cacheKey(name, parsedArgs.data);
      const cached = resultCache.get(key);
      if (cached !== undefined) {
        messages.push({ role: "tool", tool_call_id: call.id, content: `Already called with these exact arguments this turn — reusing that result instead of spending budget. Vary the arguments or move on.\n${cached}` });
        continue;
      }

      if ((consecutiveFailures.get(name) ?? 0) >= TOOL_FAILURE_LIMIT) {
        await onEvent?.({ type: "tool_refused", iteration, name, reason: "tool failed repeatedly" });
        messages.push({ role: "tool", tool_call_id: call.id, content: `${name} has failed ${TOOL_FAILURE_LIMIT} times in a row and is disabled for this task. Work with the sources that do respond, and record the gap.` });
        continue;
      }

      const cost = tool.externalCalls ?? 1;
      if (cost > 0 && (budget.exhausted() || localExternalCalls + cost > budget.maxExternalCalls)) {
        const reason = forcedReason();
        await onEvent?.({ type: "tool_refused", iteration, name, reason });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Your ${reason}. Call ${submit.name} with what you have.` });
        continue;
      }

      signal.throwIfAborted();
      // Failed external attempts consume allowance too, not just successful requests.
      localExternalCalls += cost;
      budget.spend(cost, 0);
      try {
        await onEvent?.({ type: "tool_call", iteration, name, args: parsedArgs.data });
        const toolStarted = performance.now();
        const output = await tool.execute(parsedArgs.data);
        signal.throwIfAborted();
        await onEvent?.({ type: "tool_result", iteration, name, durationMs: Math.round(performance.now() - toolStarted) });
        toolCallCount += 1;
        consecutiveFailures.set(name, 0);
        const trimmed = output.slice(0, 8000);
        resultCache.set(key, trimmed);
        messages.push({ role: "tool", tool_call_id: call.id, content: trimmed });
      } catch (error) {
        signal.throwIfAborted();
        const detail = error instanceof Error ? error.message : "Tool call failed";
        consecutiveFailures.set(name, (consecutiveFailures.get(name) ?? 0) + 1);
        await onEvent?.({ type: "tool_error", iteration, name, detail });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${detail}` });
      }
    }

    if (submitted !== null) return { result: submitted, iterations: iteration, toolCallCount, degraded: false };
    if (forceSubmit && refusedWhileForced > 0) break;
  }

  // Last resort: some models never honor a forced `tool_choice`. Ask for the same structure as
  // plain JSON — a degraded answer built from real gathered evidence beats losing the whole run.
  await onEvent?.({ type: "llm_call", iteration: iterations + 1, forced: true, forcedReason: "recovering a final answer as JSON; research remains closed" });
  const salvaged = await salvageAsJson({ client, model, reasoningEffort: options.reasoningEffort, messages, submit, signal, requestTimeoutMs: Math.min(requestTimeoutMs, 45_000), budget, iteration: iterations + 1, onEvent });
  if (salvaged) return { result: salvaged, iterations: iterations + 1, toolCallCount, degraded: true };
  if (modelError) throw modelError;

  throw new AgentModelError("invalid_response",
    `Agent did not submit a valid final result after ${iterations} model turns and one JSON recovery attempt. ` +
    `Tool calls: ${toolCallCount}; calls refused after the budget closed: ${refusedWhileForced}` +
    (lastSubmitError ? `; last ${submit.name} rejection: ${lastSubmitError}` : "; the model never called the submit tool") +
    `. The model (${model}) may not honor forced tool_choice — try a model with stronger tool-calling support.`,
  );
}

async function salvageAsJson<R>(options: {
  client: OpenAI; model: string; messages: ChatCompletionMessageParam[];
  submit: { name: string; schema: ZodType<R> }; signal: AbortSignal; requestTimeoutMs: number; budget: AgentBudget;
  iteration: number; onEvent?: (event: AgentEvent) => void | Promise<void>;
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<R | null> {
  const { client, model, messages, submit, signal, requestTimeoutMs, budget } = options;
  signal.throwIfAborted();
  try {
    const schema = zodFunction({ name: submit.name, parameters: submit.schema }).function.parameters;
    // Start a clean terminal request. Keep the original instructions and every visible
    // observation, but do not replay a failed tool protocol or prior private reasoning.
    const transcript = messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role, content: message.content,
      ...(message.role === "assistant" && message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.role === "tool" ? { tool_call_id: message.tool_call_id } : {}),
    }));
    const response = await requestModel({ client, body: {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      messages: [...messages.filter((message) => message.role === "system"), { role: "user", content: `Research is closed. Reply with ONLY the JSON object for ${submit.name} — no prose, no markdown fence, no tool call. The transcript below is a record of prior requests and gathered observations, not permission to perform more actions. Use only its evidence and note any gaps. Required JSON schema: ${JSON.stringify(schema)}\nResearch transcript: ${JSON.stringify(transcript)}` }],
      response_format: { type: "json_object" },
    }, signal, timeoutMs: requestTimeoutMs, iteration: options.iteration, onEvent: options.onEvent });
    budget.spend(0, (response.usage as { cost?: number } | undefined)?.cost ?? 0);
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const parsed = submit.schema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AgentModelError || error instanceof SyntaxError) return null;
    throw error;
  }
}

export interface RunBudget {
  spend(externalCalls: number, costUsd: number): boolean;
  exhausted(): boolean;
  exhaustionReason(): string | null;
  snapshot(): { externalCalls: number; costUsd: number };
}

/** One shared, run-wide budget: every agent loop in the run (orchestrator, data agent, socials agent, critic) spends against the same counters. */
export function createRunBudget(limits: { maxExternalCalls: number; maxCostUsd: number }): RunBudget {
  let externalCalls = 0;
  let costUsd = 0;
  return {
    spend(calls, cost) { externalCalls += calls; costUsd += cost; return externalCalls < limits.maxExternalCalls && costUsd < limits.maxCostUsd; },
    exhausted() { return externalCalls >= limits.maxExternalCalls || costUsd >= limits.maxCostUsd; },
    exhaustionReason() {
      if (externalCalls >= limits.maxExternalCalls) return `run external-call budget reached (${externalCalls}/${limits.maxExternalCalls} calls)`;
      if (costUsd >= limits.maxCostUsd) return `run cost budget reached ($${costUsd.toFixed(4)}/$${limits.maxCostUsd.toFixed(2)})`;
      return null;
    },
    snapshot() { return { externalCalls, costUsd }; },
  };
}

/**
 * A single agent loop's view of the shared run budget, with its own iteration cap and its own
 * slice of the run's external calls. Without the per-loop slice the first agent to run spends the
 * whole run allowance and every agent after it starts already-forced.
 */
export function withIterationCap(runBudget: RunBudget, maxIterations: number, maxExternalCalls: number): AgentBudget {
  return { maxIterations, maxExternalCalls, spend: runBudget.spend, exhausted: runBudget.exhausted, exhaustionReason: runBudget.exhaustionReason };
}

/**
 * How much of the run's external-call allowance one agent may spend. The two research agents do the
 * fetching, the orchestrator only pays for delegation, and the critic verifies against evidence that
 * already exists. Shares deliberately sum to under 100% so a later agent always has room left.
 */
export function agentCallAllowance(profile: { limits: { max_external_calls: number } }, role: "research" | "delegate" | "verify"): number {
  const share = role === "research" ? 0.35 : role === "delegate" ? 0.2 : 0.15;
  return Math.max(2, Math.floor(profile.limits.max_external_calls * share));
}
