import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { AgentEvent } from "./loop";

/** A provider failure callers may degrade around; validation/programming errors still surface. */
export class AgentModelError extends Error {
  constructor(public readonly kind: "timeout" | "unavailable" | "invalid_response", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentModelError";
  }
}

export async function requestModel(options: {
  client: OpenAI;
  body: ChatCompletionCreateParamsNonStreaming;
  signal: AbortSignal;
  timeoutMs: number;
  iteration: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
}) {
  const { client, body, signal, timeoutMs, iteration, onEvent } = options;
  signal.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const started = performance.now();
  try {
    // One visible turn = one provider attempt. SDK retries used to hide extra work/latency.
    const response = await client.chat.completions.create(body, {
      signal: AbortSignal.any([signal, deadline.signal]), maxRetries: 0,
    });
    signal.throwIfAborted();
    const usage = response.usage;
    await onEvent?.({ type: "llm_result", iteration, durationMs: Math.round(performance.now() - started),
      promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null });
    return response;
  } catch (cause) {
    // A run deadline/cancellation is not a recoverable individual-request timeout.
    signal.throwIfAborted();
    const error = deadline.signal.aborted
      ? new AgentModelError("timeout", `Model ${body.model} timed out after ${Math.round(timeoutMs / 1000)}s on turn ${iteration}.`, { cause })
      : cause instanceof OpenAI.APIConnectionError || (cause instanceof OpenAI.APIError && (cause.status === 408 || cause.status === 429 || (cause.status ?? 0) >= 500))
        ? new AgentModelError("unavailable", `Model ${body.model} was unavailable on turn ${iteration}${cause instanceof OpenAI.APIError && cause.status ? ` (HTTP ${cause.status})` : ""}.`, { cause })
        : cause;
    await onEvent?.({ type: "llm_error", iteration, durationMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : "Model request failed" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
