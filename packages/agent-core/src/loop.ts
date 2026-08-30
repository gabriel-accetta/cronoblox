import type OpenAI from "openai";
import { zodFunction } from "openai/helpers/zod";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ZodType } from "zod";

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
  /** Records spend and returns whether the run-wide budget still has room. */
  spend(externalCalls: number, costUsd: number): boolean;
  exhausted(): boolean;
}

export type AgentEvent =
  | { type: "llm_call"; iteration: number; forced: boolean }
  | { type: "tool_call"; iteration: number; name: string; args: unknown }
  | { type: "tool_error"; iteration: number; name: string; detail: string }
  | { type: "submit"; iteration: number }
  | { type: "nudge"; iteration: number };

export interface AgentLoopResult<R> {
  result: R;
  iterations: number;
  toolCallCount: number;
}

/**
 * A hand-rolled tool-calling agent loop: call the model, execute whatever tools it asks
 * for, feed results back, repeat until it calls the designated `submit` tool. Domain-agnostic —
 * callers supply tools, a submit schema, and a budget; this file knows nothing about Cronoblox.
 */
export async function runAgentLoop<R>(options: {
  client: OpenAI;
  model: string;
  system: string;
  userInput: unknown;
  tools: AgentTool[];
  submit: { name: string; description: string; schema: ZodType<R> };
  budget: AgentBudget;
  /** Aborts an in-flight model call once the run's overall deadline (max_runtime_ms) fires — without this, a slow/stuck LLM call ignores the run budget entirely. */
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}): Promise<AgentLoopResult<R>> {
  const { client, model, system, userInput, tools, submit, budget, signal, onEvent } = options;
  if (signal.aborted) throw new Error("Run exceeded its runtime budget");
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const toolDefs: ChatCompletionTool[] = tools.map((tool) => zodFunction({ name: tool.name, parameters: tool.parameters, description: tool.description }));
  const submitDef: ChatCompletionTool = zodFunction({ name: submit.name, parameters: submit.schema, description: submit.description });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(userInput) },
  ];

  let toolCallCount = 0;
  let lastSubmitError: string | null = null;
  // A few extra turns reserved purely for forcing a conclusion once the main budget is spent —
  // some providers don't reliably honor `tool_choice` forcing a specific function, so once forced
  // we also stop offering any other tool, which is what actually guarantees termination.
  const hardCap = budget.maxIterations + 3;

  for (let iteration = 1; iteration <= hardCap; iteration += 1) {
    if (signal.aborted) throw new Error("Run exceeded its runtime budget");
    const forceSubmit = budget.exhausted() || iteration >= budget.maxIterations;
    if (lastSubmitError) {
      messages.push({ role: "user", content: `Your last ${submit.name} call was invalid: ${lastSubmitError}. Call ${submit.name} again with corrected arguments.` });
      lastSubmitError = null;
    }

    await onEvent?.({ type: "llm_call", iteration, forced: forceSubmit });
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: forceSubmit ? [submitDef] : [...toolDefs, submitDef],
      tool_choice: forceSubmit ? { type: "function", function: { name: submit.name } } : "auto",
    }, { signal });
    const cost = (response.usage as { cost?: number } | undefined)?.cost ?? 0;
    budget.spend(0, cost);

    const message = response.choices[0]?.message;
    if (!message) throw new Error("Agent loop received no message from the model");
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (!calls.length) {
      messages.push({ role: "user", content: `Call a tool, or call ${submit.name} with your final structured answer.` });
      await onEvent?.({ type: "nudge", iteration });
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

      const tool = toolMap.get(name);
      if (!tool) { messages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` }); continue; }
      const parsedArgs = tool.parameters.safeParse(args);
      if (!parsedArgs.success) { messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid arguments: ${parsedArgs.error.message}` }); continue; }

      try {
        await onEvent?.({ type: "tool_call", iteration, name, args: parsedArgs.data });
        const output = await tool.execute(parsedArgs.data);
        toolCallCount += 1;
        budget.spend(tool.externalCalls ?? 1, 0);
        messages.push({ role: "tool", tool_call_id: call.id, content: output.slice(0, 8000) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Tool call failed";
        await onEvent?.({ type: "tool_error", iteration, name, detail });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${detail}` });
      }
    }

    if (submitted !== null) return { result: submitted, iterations: iteration, toolCallCount };
  }

  throw new Error(`Agent exceeded its iteration budget (${budget.maxIterations}, plus forced-conclusion retries) without submitting a final result`);
}

export interface RunBudget {
  spend(externalCalls: number, costUsd: number): boolean;
  exhausted(): boolean;
  snapshot(): { externalCalls: number; costUsd: number };
}

/** One shared, run-wide budget: every agent loop in the run (orchestrator, data agent, socials agent, critic) spends against the same counters. */
export function createRunBudget(limits: { maxExternalCalls: number; maxCostUsd: number }): RunBudget {
  let externalCalls = 0;
  let costUsd = 0;
  return {
    spend(calls, cost) { externalCalls += calls; costUsd += cost; return externalCalls < limits.maxExternalCalls && costUsd < limits.maxCostUsd; },
    exhausted() { return externalCalls >= limits.maxExternalCalls || costUsd >= limits.maxCostUsd; },
    snapshot() { return { externalCalls, costUsd }; },
  };
}

/** A single agent loop's view of the shared run budget, with its own iteration cap. */
export function withIterationCap(runBudget: RunBudget, maxIterations: number): AgentBudget {
  return { maxIterations, spend: runBudget.spend, exhausted: runBudget.exhausted };
}
