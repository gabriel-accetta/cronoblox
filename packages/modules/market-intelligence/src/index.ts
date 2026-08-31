import { z } from "zod";
import { agentCallAllowance, createOpenRouterClient, runAgentLoop, withIterationCap, type AgentTool } from "@cronoblox/agent-core";
import { createFetchPageTool, createYouTubeSearchTool, emitAgentEvent, toToolRuntime, toolAvailability } from "@cronoblox/agent-tools";
import { createEvidence } from "@cronoblox/evidence";
import type { Evidence } from "@cronoblox/contracts";
import type { CronobloxModule } from "@cronoblox/module-sdk";

export const MarketInputSchema = z.object({
  focus: z.string().min(1),
  game: z.object({ name: z.string(), description: z.string(), genre: z.string().nullable() }),
});

const MarketSubmitSchema = z.object({
  summary: z.string(),
  notable_findings: z.array(z.string()).max(6),
  contradictions: z.array(z.string()),
  signal_strength: z.enum(["low", "medium", "high"]),
});

export const MarketOutputSchema = MarketSubmitSchema.extend({
  video_results: z.number(), creator_count: z.number(),
});
export type MarketOutput = z.infer<typeof MarketOutputSchema>;

const MODULE_LABEL = "The socials agent";
const SYSTEM = `You are the Cronoblox Socials Agent, a sub-agent invoked by the research orchestrator to investigate a Roblox game's real-world attention: YouTube creator activity and creator diversity.
You have youtube_search and fetch_page tools. Decide how many searches are worth running and which results are worth opening with fetch_page to verify — but your input states a research_effort and a search_call_allowance, and you must work inside it. At low effort, run one or two well-chosen searches and conclude; do not sweep the topic. Repeating a query that already answered your question is refused, not free. When you have enough signal (or tools are unavailable/exhausted), call submit_socials_findings. Only report findings backed by what your tool calls actually returned — never invent a source, statistic, or URL. A short observation window is not evidence against the game; say so explicitly rather than treating absence of data as a negative signal. There is no general web-search tool in this run — YouTube coverage is the only live social signal available, so say so plainly rather than implying broader web coverage was checked.`;

const fixture = { creator_count: 6, recent_video_count: 5 };

export const marketIntelligenceModule: CronobloxModule<z.infer<typeof MarketInputSchema>, MarketOutput> = {
  manifest: { id: "market-intelligence", name: "Trend, Social & Comparable Intelligence", version: "2.1.0", required: false, phase: "research", dependencies: ["roblox-data"], defaultConfig: { maxIterations: 4 } },
  inputSchema: MarketInputSchema, outputSchema: MarketOutputSchema,
  async execute(input, context) {
    const observed = context.now().toISOString();

    if (context.profile.fixture_mode) {
      const output: MarketOutput = { summary: "Cached fixture research sample.", notable_findings: [`${fixture.recent_video_count} recent videos from ${fixture.creator_count} independent creators were present in the cached research sample.`], contradictions: ["The largest recent attention cluster followed a major update", "Creator coverage is recent but still a short observation window"], signal_strength: "medium", video_results: fixture.recent_video_count, creator_count: fixture.creator_count };
      const coverageEvidence = createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "fact", claim: "Five recent videos from six independent creators were present in the cached research sample.", source: { type: "fixture", url: "https://www.youtube.com/results?search_query=roblox+build+a+boat+odyssey", retrieved_at: observed, cache_key: "fixture:market:odyssey" }, observation: { value: { videos: 5, creators: 6 }, unit: "results_sample", raw_ref: "raw/market-fixture.json" }, derivation: null, support_strength: "medium", relationship: "supports", related_claim_ids: [], notes: "Search relevance is not a population measurement.", used_by: ["orchestrator", "critic", "report"] });
      const evidence = [
        coverageEvidence,
        createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "inference", claim: "Recent attention is diverse enough to avoid a single-creator explanation, but persistence is unproven.", source: { type: "derived", url: null, retrieved_at: observed, cache_key: null }, observation: { value: "diverse_short_window", unit: null, raw_ref: null }, derivation: { method: "Creator concentration review", formula: null, derived_from: [coverageEvidence.id] }, support_strength: "medium", relationship: "contextualizes", related_claim_ids: [], notes: "Fixture inference; historical growth is not claimed.", used_by: ["orchestrator", "critic", "report"] }),
      ];
      await context.saveRawArtifact("fixture", "market", output);
      return { status: "completed", output, evidence, suggested_next_steps: ["Test whether attention persists after the update window"], warnings: ["Cached fixture data — not live YouTube research"], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const availability = toolAvailability(context.profile);
    const evidenceSink: Evidence[] = [];
    const runtime = toToolRuntime(context, "market-intelligence", evidenceSink);
    const warnings: string[] = [];
    if (!availability.youtube) warnings.push("YouTube research disabled by profile");

    const tools: AgentTool<any>[] = [createFetchPageTool(runtime)];
    if (availability.youtube) tools.push(createYouTubeSearchTool(runtime));

    if (tools.length === 1) {
      return { status: "degraded", output: { summary: "No search provider was configured; the socials agent could not run any research.", notable_findings: [], contradictions: warnings, signal_strength: "low", video_results: 0, creator_count: 0 }, evidence: [], suggested_next_steps: ["Enable the youtube tool for this profile"], warnings, metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const client = createOpenRouterClient();
    const { result, toolCallCount, degraded } = await runAgentLoop({
      client, model: context.profile.model, reasoningEffort: context.profile.reasoning_effort, system: SYSTEM,
      userInput: { focus: input.focus, game: input.game, research_effort: context.profile.effort, search_call_allowance: agentCallAllowance(context.profile, "research") },
      tools,
      submit: { name: "submit_socials_findings", description: "Submit your final findings for this delegation.", schema: MarketSubmitSchema },
      budget: withIterationCap(context.budget, 4, agentCallAllowance(context.profile, "research")),
      signal: context.signal,
      onEvent: (event) => emitAgentEvent(context, "market-intelligence", event),
    });

    const videoResults = evidenceSink.filter((item) => item.source.type === "youtube_ytdlp").length;
    if (degraded) warnings.push(`${MODULE_LABEL} returned its findings through the bounded JSON recovery path rather than a submit tool call.`);
    const creatorCount = new Set(evidenceSink.filter((item) => item.source.type === "youtube_ytdlp").map((item) => (item.observation?.value as { channel?: string } | null)?.channel).filter((value): value is string => Boolean(value))).size;
    const output: MarketOutput = { ...result, video_results: videoResults, creator_count: creatorCount };

    return { status: warnings.length ? "degraded" : "completed", output, evidence: evidenceSink, suggested_next_steps: warnings.length ? ["Enable the youtube tool for fuller coverage"] : [], warnings, metrics: { duration_ms: 0, external_calls: toolCallCount, estimated_cost_usd: null } };
  },
};
