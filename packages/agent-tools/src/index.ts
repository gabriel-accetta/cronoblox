import { z } from "zod";
import type { AgentEvent, AgentTool } from "@cronoblox/agent-core";
import type { Evidence, ProfileSnapshot } from "@cronoblox/contracts";
import { createEvidence } from "@cronoblox/evidence";
import type { ModuleContext } from "@cronoblox/module-sdk";
import { RobloxSource } from "@cronoblox/source-roblox";
import { WebPageSource } from "@cronoblox/source-webpage";
import { YouTubeSource } from "@cronoblox/source-youtube";

export interface ToolRuntime {
  moduleId: string;
  runId: string;
  now: () => Date;
  signal: AbortSignal;
  /** How many results a search keeps — the run's effort level, pushed down to the tools. */
  maxSearchResults: number;
  saveRawArtifact: (provider: string, key: string, payload: unknown) => Promise<void>;
  pushEvidence: (item: Evidence) => void;
}

export function toToolRuntime(context: ModuleContext, moduleId: string, evidenceSink: Evidence[]): ToolRuntime {
  return {
    moduleId, runId: context.runId, now: context.now, signal: context.signal,
    maxSearchResults: context.profile.limits.max_search_results,
    saveRawArtifact: context.saveRawArtifact,
    pushEvidence: (item) => evidenceSink.push(item),
  };
}

/** Which real tools an agent is allowed to see this run: gated on the profile's enabled_tools list. */
export function toolAvailability(profile: ProfileSnapshot) {
  return {
    // yt-dlp needs no API key or quota — availability is just whether the profile allows it; a missing binary surfaces as a clear tool_error at call time.
    youtube: profile.enabled_tools.includes("youtube"),
    roblox: profile.enabled_tools.includes("roblox"),
  };
}

/** Drops any id an agent cited that doesn't correspond to a real record — the anti-hallucination guard applied at every agent boundary, not just at final report assembly. */
export function keepKnownIds(ids: readonly string[], known: ReadonlySet<string>): string[] {
  return ids.filter((id) => known.has(id));
}

export function createEvidenceLookupTool(evidence: readonly Evidence[]): AgentTool<{ evidence_id: string }> {
  return {
    name: "get_evidence_by_id",
    description: "Look up the full detail (claim, source URL, observation, support strength) of one evidence record by its id.",
    parameters: z.object({ evidence_id: z.string().min(1) }),
    externalCalls: 0,
    async execute({ evidence_id }) {
      const item = evidence.find((entry) => entry.id === evidence_id);
      return item ? JSON.stringify(item) : `No evidence found with id ${evidence_id}`;
    },
  };
}

/** Argument keys worth showing in the timeline, most identifying first. */
const ARG_PREVIEW_KEYS = ["query", "focus", "url", "evidence_id", "sort_id", "reason"];

/**
 * A short, human-readable "what was this call actually about" for the visible trajectory —
 * without it, ten `roblox_search_peers` rows are indistinguishable to the reader.
 */
export function describeToolArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const ordered = [...ARG_PREVIEW_KEYS.filter((key) => key in record), ...Object.keys(record).filter((key) => !ARG_PREVIEW_KEYS.includes(key))];
  const parts: string[] = [];
  for (const key of ordered) {
    const value = record[key];
    const text = typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
    if (text) parts.push(text);
    if (parts.length === 2) break;
  }
  if (!parts.length) return null;
  const detail = parts.join(" — ").replace(/\s+/g, " ");
  return detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
}

/** Turns a generic agent-loop event into a run event visible in the run's timeline. */
export function emitAgentEvent(context: ModuleContext, agentName: string, event: AgentEvent): Promise<void> | void {
  switch (event.type) {
    case "llm_call":
      return context.emit("info", `${agentName}.${event.forced ? "finalizing" : "llm_call"}`, event.forced ? `${agentName} is wrapping up — ${event.forcedReason ?? "a conclusion is required"}` : `${agentName} is waiting for the model (turn ${event.iteration})`, { iteration: event.iteration, reason: event.forcedReason ?? null });
    case "llm_result":
      return context.emit("info", `${agentName}.llm_result`, `${agentName}'s model replied in ${(event.durationMs / 1000).toFixed(1)}s (turn ${event.iteration})`, { iteration: event.iteration, duration_ms: event.durationMs, prompt_tokens: event.promptTokens, completion_tokens: event.completionTokens, reasoning_tokens: event.reasoningTokens });
    case "llm_error":
      return context.emit("warning", `${agentName}.llm_error`, `${agentName}: ${event.detail}`, { iteration: event.iteration, duration_ms: event.durationMs });
    case "tool_call": {
      const detail = describeToolArgs(event.args);
      return context.emit("info", `${agentName}.tool_call`, detail ? `${agentName} called ${event.name} — ${detail}` : `${agentName} called ${event.name}`, { tool: event.name, detail, args: event.args });
    }
    case "tool_error":
      return context.emit("warning", `${agentName}.tool_error`, `${agentName}'s ${event.name} call failed: ${event.detail}`, { tool: event.name, detail: `failed — ${event.detail}` });
    case "tool_result":
      return context.emit("info", `${agentName}.tool_result`, `${agentName}'s ${event.name} finished in ${(event.durationMs / 1000).toFixed(1)}s`, { tool: event.name, duration_ms: event.durationMs, detail: `finished in ${(event.durationMs / 1000).toFixed(1)}s` });
    case "tool_refused":
      return context.emit("warning", `${agentName}.tool_refused`, `${agentName}'s ${event.name} call was refused — ${event.reason}`, { tool: event.name, detail: `refused — ${event.reason}` });
    case "submit":
      return context.emit("info", `${agentName}.submit`, `${agentName} submitted its findings`);
    case "nudge":
      return context.emit("warning", `${agentName}.nudge`, `${agentName} replied without calling a tool; nudged to continue`);
    default:
      return undefined;
  }
}

export function createFetchPageTool(runtime: ToolRuntime): AgentTool<{ url: string; reason: string }> {
  const source = new WebPageSource();
  return {
    name: "fetch_page",
    description: "Fetch a specific URL (usually one found via web_search or youtube_search) and read its text content. Use this to verify a claim or get detail a search snippet doesn't have.",
    parameters: z.object({ url: z.string().url(), reason: z.string().min(1) }),
    externalCalls: 1,
    async execute({ url, reason }) {
      const page = await source.fetchReadable(url, runtime.signal);
      await runtime.saveRawArtifact("webpage", url, page);
      const observed = runtime.now().toISOString();
      const evidence = createEvidence({
        run_id: runtime.runId, module_id: runtime.moduleId, kind: "fact",
        claim: `${page.title ?? url}: ${page.text.slice(0, 240).replace(/\s+/g, " ")}`,
        source: { type: "webpage", url: page.url, retrieved_at: observed, cache_key: null },
        observation: { value: page.title, unit: "page", raw_ref: null },
        derivation: null, support_strength: "medium", relationship: "contextualizes",
        related_claim_ids: [], notes: reason, used_by: ["orchestrator", "critic", "report"],
      });
      runtime.pushEvidence(evidence);
      return JSON.stringify({ evidence_id: evidence.id, title: page.title, truncated: page.truncated, text: page.text.slice(0, 4000) });
    },
  };
}

export function createYouTubeSearchTool(runtime: ToolRuntime): AgentTool<{ query: string }> {
  const youtube = new YouTubeSource();
  return {
    name: "youtube_search",
    description: `Search YouTube (via yt-dlp, no quota) for videos matching a query. Returns up to ${runtime.maxSearchResults} results with channel, view count, and description — publish date and like/comment counts are not available from this fast search mode.`,
    parameters: z.object({ query: z.string().min(1) }),
    externalCalls: 1,
    async execute({ query }) {
      const videos = await youtube.search(query, runtime.signal, runtime.maxSearchResults);
      await runtime.saveRawArtifact("youtube", `search:${query}`, videos);
      const observed = runtime.now().toISOString();
      const items = videos.slice(0, runtime.maxSearchResults).map((item) => {
        const evidence = createEvidence({
          run_id: runtime.runId, module_id: runtime.moduleId, kind: "fact",
          claim: `${item.channelTitle} published "${item.title}" (${item.views == null ? "view count unavailable" : `${item.views.toLocaleString()} views`}).`,
          source: { type: "youtube_ytdlp", url: `https://www.youtube.com/watch?v=${item.id}`, retrieved_at: observed, cache_key: null },
          observation: { value: { channel: item.channelTitle, views: item.views, description: item.description.slice(0, 300) }, unit: "video", raw_ref: null },
          derivation: null, support_strength: "medium", relationship: "contextualizes",
          related_claim_ids: [], notes: `Query: ${query}. Publish date and like/comment counts are not available from this search mode.`, used_by: ["orchestrator", "critic", "report"],
        });
        runtime.pushEvidence(evidence);
        return { evidence_id: evidence.id, title: item.title, channel: item.channelTitle, url: `https://www.youtube.com/watch?v=${item.id}`, views: item.views, description: item.description.slice(0, 200) };
      });
      return items.length ? JSON.stringify(items) : `No videos for "${query}".`;
    },
  };
}

function rawJsonTool<A extends Record<string, unknown>>(runtime: ToolRuntime, provider: string, opts: { name: string; description: string; parameters: z.ZodType<A>; call: (args: A) => Promise<unknown>; claim: (args: A) => string }): AgentTool<A> {
  return {
    name: opts.name, description: opts.description, parameters: opts.parameters, externalCalls: 1,
    async execute(args) {
      const payload = await opts.call(args);
      const key = `${opts.name}:${Object.values(args).map(String).join(",") || "none"}`;
      await runtime.saveRawArtifact(provider, key, payload);
      const observed = runtime.now().toISOString();
      const raw = JSON.stringify(payload);
      const evidence = createEvidence({
        run_id: runtime.runId, module_id: runtime.moduleId, kind: "fact",
        claim: opts.claim(args), source: { type: provider, url: null, retrieved_at: observed, cache_key: null },
        observation: { value: null, unit: "raw_json", raw_ref: key }, derivation: null, support_strength: "low",
        relationship: "contextualizes", related_claim_ids: [], notes: "Undocumented Roblox endpoint; treat as exploratory context, not a verified metric.",
        used_by: ["orchestrator", "critic", "report"],
      });
      runtime.pushEvidence(evidence);
      return JSON.stringify({ evidence_id: evidence.id, raw: raw.length > 3500 ? `${raw.slice(0, 3500)}…(truncated)` : raw });
    },
  };
}

/** Wraps RobloxSource.searchPeers — free-text search across Roblox's catalog, useful for finding comparables the recommendation graph missed. */
export function createRobloxPeerSearchTool(runtime: ToolRuntime): AgentTool<{ query: string }> {
  const source = new RobloxSource();
  return rawJsonTool(runtime, "roblox_search", {
    name: "roblox_search_peers",
    description: "Free-text search across Roblox's game catalog (omni-search). Use it to find comparable/competitor games by genre or theme keywords, beyond the audited game's own recommendation graph.",
    parameters: z.object({ query: z.string().min(1) }),
    call: ({ query }) => source.searchPeers(query, runtime.signal),
    claim: ({ query }) => `Roblox catalog search results for "${query}".`,
  });
}

/** Wraps RobloxSource.getExploreSorts — lists the trending/charts categories shown on the Roblox home page. */
export function createRobloxListChartsTool(runtime: ToolRuntime) {
  const source = new RobloxSource();
  return rawJsonTool(runtime, "roblox_explore", {
    name: "roblox_list_trending_charts",
    description: "List Roblox's current home-page discovery charts (e.g. Top Trending, Popular in a genre). Call roblox_get_chart_games afterward with a sortId from the result to see which games are on a chart.",
    parameters: z.object({}),
    call: () => source.getExploreSorts(runtime.signal),
    claim: () => "Current Roblox discovery chart categories.",
  });
}

/** Wraps RobloxSource.getExploreSortContent — the games listed under a specific chart from roblox_list_trending_charts. */
export function createRobloxChartGamesTool(runtime: ToolRuntime): AgentTool<{ sortId: string }> {
  const source = new RobloxSource();
  return rawJsonTool(runtime, "roblox_explore", {
    name: "roblox_get_chart_games",
    description: "Get the games listed under one Roblox discovery chart. Requires a sortId from roblox_list_trending_charts.",
    parameters: z.object({ sortId: z.string().min(1) }),
    call: ({ sortId }) => source.getExploreSortContent(sortId, runtime.signal),
    claim: ({ sortId }) => `Games on Roblox discovery chart "${sortId}".`,
  });
}
