import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createRobloxChartGamesTool, createRobloxListChartsTool, createRobloxPeerSearchTool,
  createYouTubeSearchTool, type ToolRuntime,
} from "@cronoblox/agent-tools";
import { PublicToolResultSchema, type Evidence, type PublicToolResult } from "@cronoblox/contracts";
import { collectRobloxData, RobloxDataOutputSchema } from "@cronoblox/module-roblox-data";
import { parsePlaceId, ProviderError } from "@cronoblox/source-roblox";

const query = z.string().trim().min(1).max(160);
const game = z.string().trim().min(1).max(512).refine((value) => {
  try { parsePlaceId(value); return true; } catch { return false; }
}, "Use a public roblox.com/games URL or a numeric place/experience ID.");

export const toolInputs = {
  cronoblox_audit_game: z.object({ game_url: game }).strict(),
  cronoblox_search_peers: z.object({ query }).strict(),
  cronoblox_list_charts: z.object({}).strict(),
  cronoblox_get_chart_games: z.object({ sort_id: z.string().trim().min(1).max(200) }).strict(),
  cronoblox_search_youtube: z.object({ query }).strict(),
};
export type ToolName = keyof typeof toolInputs;

export const toolDescriptions: Record<ToolName, string> = {
  cronoblox_audit_game: "Audit one public Roblox game: identity, current players, lifetime visits, votes, favorites, badge activity and candidate peers. Returns timestamped facts, computed metrics, source links and coverage warnings. No AI analysis or saved report. Start here for game investigations; snapshots do not establish growth or retention.",
  cronoblox_search_peers: "Search Roblox's catalog by genre, theme or game name to discover candidate comparable games. Exploratory, undocumented endpoint; audit candidates before comparing metrics. Similarity is not established by appearing in search.",
  cronoblox_list_charts: "List Roblox discovery chart categories and their sort IDs. Use a returned ID with cronoblox_get_chart_games. This is discovery context, not historical trend data.",
  cronoblox_get_chart_games: "Read games on one Roblox discovery chart using a sort_id returned by cronoblox_list_charts. Chart appearance alone does not prove durable momentum.",
  cronoblox_search_youtube: "Find up to five YouTube videos about a Roblox game, with channels, views, descriptions and source URLs. Fast search does not supply publish dates, likes, comments or transcripts; it cannot establish recency. Empty results are not evidence of no coverage. No model calls.",
};

function runTool<A>(tool: { parameters: z.ZodType<A>; execute: (args: A) => Promise<string> }, args: unknown) {
  return tool.execute(tool.parameters.parse(args));
}

const SNAPSHOT_WARNING = "Current observations are snapshots, not historical growth or retention. Missing data is unknown, not zero.";
const DISCOVERY_WARNING = "Roblox discovery endpoints are undocumented. Treat these results as exploratory context, not verified metrics.";

/** Reuses the worker's provider tools without importing its engine, DB, queue or model client. */
export async function executeDataTool(name: ToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<PublicToolResult> {
  const evidence: Evidence[] = [];
  const runtime: ToolRuntime = {
    runId: randomUUID(), moduleId: "public-mcp", now: () => new Date(), signal,
    maxSearchResults: 5,
    // Public responses contain their evidence. No report, raw artifact or user query is persisted.
    saveRawArtifact: async () => undefined,
    pushEvidence: (item) => { evidence.push(item); },
  };
  let data: Record<string, unknown>;
  let status: PublicToolResult["status"] = "completed";
  const warnings: string[] = [];
  if (name === "cronoblox_audit_game") {
    const result = await collectRobloxData({ game_url: String(args.game_url) }, {
      ...runtime, profile: { fixture_mode: false },
    });
    data = RobloxDataOutputSchema.parse(result.output);
    evidence.push(...result.evidence);
    warnings.push(...result.warnings, SNAPSHOT_WARNING,
      "Estimated active servers and badge activity are proxies, not measured server counts, unique users or retention.");
    status = result.status === "degraded" ? "degraded" : "completed";
  } else {
    const output = await (name === "cronoblox_search_peers" ? runTool(createRobloxPeerSearchTool(runtime), args)
      : name === "cronoblox_list_charts" ? runTool(createRobloxListChartsTool(runtime), args)
      : name === "cronoblox_get_chart_games" ? runTool(createRobloxChartGamesTool(runtime), { sortId: args.sort_id })
      : runTool(createYouTubeSearchTool(runtime), args));
    let parsed: unknown;
    try { parsed = JSON.parse(output); } catch { parsed = { message: output }; }
    data = { result: parsed };
    if (name === "cronoblox_search_youtube") {
      warnings.push("Publish dates, likes, comments and transcripts are unavailable. Results may be incomplete; do not infer recent momentum from them.");
    } else {
      warnings.push(DISCOVERY_WARNING);
      const sourceUrl = name === "cronoblox_search_peers"
        ? `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(String(args.query))}&pageType=all`
        : name === "cronoblox_list_charts"
          ? "https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=cronoblox-evaluation&device=computer&country=US"
          : `https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=cronoblox-evaluation&sortId=${encodeURIComponent(String(args.sort_id))}&device=computer&country=US`;
      for (const item of evidence) item.source.url = sourceUrl;
      if (output.includes("…(truncated)")) warnings.push("Discovery output was truncated; do not treat this as the complete catalog or chart.");
    }
  }
  for (const item of evidence) if (item.observation) item.observation.raw_ref = null;
  return PublicToolResultSchema.parse({
    status, observed_at: runtime.now().toISOString(), data, evidence, warnings, cached: false, model_calls: 0,
  });
}

/** Errors from subprocesses/fetch can contain host paths or command arguments. Never expose them. */
export function publicToolError(name: ToolName, error: unknown): string {
  if (error instanceof ProviderError) return `Roblox data is unavailable${error.status ? ` (HTTP ${error.status})` : ""}. Report the coverage gap; do not invent a result.`;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "The data request timed out. Continue with available evidence and report the missing coverage.";
  if (name === "cronoblox_search_youtube") return "YouTube search is unavailable. The host needs a working yt-dlp installation and network access. Continue without creator coverage; do not fabricate it.";
  return "The public data provider could not complete this request. Continue with available evidence and disclose the coverage gap.";
}
