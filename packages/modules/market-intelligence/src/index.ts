import { z } from "zod";
import { createEvidence } from "@cronoblox/evidence";
import type { CronobloxModule } from "@cronoblox/module-sdk";
import { BraveSource } from "@cronoblox/source-brave";
import { YouTubeSource } from "@cronoblox/source-youtube";

export const MarketInputSchema = z.object({ name: z.string(), description: z.string(), genre: z.string().nullable(), recommendation_count: z.number(), recommendations: z.array(z.object({ name: z.string(), universe_id: z.string().nullable(), player_count: z.number().nullable(), reason: z.string() })) });
export const MarketOutputSchema = z.object({ direct_results: z.number(), creator_count: z.number(), recent_video_count: z.number(), extracted_terms: z.array(z.string()), comparables: z.array(z.object({ name: z.string(), reason: z.string() })), contradictions: z.array(z.string()), source_diversity: z.number(), signal_strength: z.enum(["low", "medium", "high"]), confidence: z.enum(["low", "medium", "high"]) });

const stop = new Set(["with", "your", "this", "that", "from", "into", "game", "roblox", "build", "play", "friends"]);
function extractTerms(text: string) { return [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !stop.has(word)))].slice(0, 5); }

export const marketIntelligenceModule: CronobloxModule<z.infer<typeof MarketInputSchema>, z.infer<typeof MarketOutputSchema>> = {
  manifest: { id: "market-intelligence", name: "Trend, Social & Comparable Intelligence", version: "1.0.0", required: false, phase: "research", dependencies: ["roblox-data"], defaultConfig: { recencyDays: 365 } },
  inputSchema: MarketInputSchema, outputSchema: MarketOutputSchema,
  async execute(input, context) {
    const observed = context.now().toISOString();
    const terms = extractTerms(`${input.description} ${input.genre ?? ""}`);
    if (context.profile.fixture_mode) {
      const output = { direct_results: 8, creator_count: 6, recent_video_count: 5, extracted_terms: terms.length ? terms : ["creative", "ships", "exploration"], comparables: [{ name: "Build A Boat For Treasure", reason: "Shared creative construction loop and broad social audience" }, { name: "Plane Crazy", reason: "Player-built vehicles and experimentation" }, { name: "Theme Park Tycoon 2", reason: "Long-session creation loop and durable progression" }], contradictions: ["The largest recent attention cluster followed a major update", "Creator coverage is recent but still a short observation window"], source_diversity: 7, signal_strength: "medium" as const, confidence: "medium" as const };
      const coverageEvidence = createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "fact", claim: "Five recent videos from six independent creators were present in the cached research sample.", source: { type: "fixture", url: "https://www.youtube.com/results?search_query=roblox+build+a+boat+odyssey", retrieved_at: observed, cache_key: "fixture:market:odyssey" }, observation: { value: { videos: 5, creators: 6 }, unit: "results_sample", raw_ref: "raw/market-fixture.json" }, derivation: null, support_strength: "medium", relationship: "supports", related_claim_ids: [], notes: "Search relevance is not a population measurement.", used_by: ["orchestrator", "critic", "report"] });
      const evidence = [
        coverageEvidence,
        createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "inference", claim: "Recent attention is diverse enough to avoid a single-creator explanation, but persistence is unproven.", source: { type: "derived", url: null, retrieved_at: observed, cache_key: null }, observation: { value: "diverse_short_window", unit: null, raw_ref: null }, derivation: { method: "Creator concentration review", formula: null, derived_from: [coverageEvidence.id] }, support_strength: "medium", relationship: "contextualizes", related_claim_ids: [], notes: "Fixture inference; historical growth is not claimed.", used_by: ["orchestrator", "critic", "report"] }),
      ];
      await context.saveRawArtifact("fixture", "market", output);
      return { status: "completed", output, evidence, suggested_next_steps: ["Test whether attention persists after the update window"], warnings: ["Cached fixture data — not live web or YouTube research"], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const brave = new BraveSource(); const youtube = new YouTubeSource(); const warnings: string[] = [];
    const [webResult, videoResult] = await Promise.allSettled([
      brave.available ? brave.search(`"${input.name}" Roblox`, context.signal) : Promise.reject(new Error("Brave Search key missing")),
      youtube.available ? youtube.search(`${input.name} Roblox`, context.signal) : Promise.reject(new Error("YouTube API key missing")),
    ] as const);
    const web = webResult.status === "fulfilled" ? webResult.value : [];
    const videos = videoResult.status === "fulfilled" ? videoResult.value : [];
    if (webResult.status === "rejected") warnings.push(`Web research unavailable: ${webResult.reason instanceof Error ? webResult.reason.message : "unknown error"}`);
    if (videoResult.status === "rejected") warnings.push(`YouTube research unavailable: ${videoResult.reason instanceof Error ? videoResult.reason.message : "unknown error"}`);
    await context.saveRawArtifact("brave", "direct-search", web); await context.saveRawArtifact("youtube", "direct-search", videos);
    const channels = new Set(videos.map((item) => item.channelId));
    const output = { direct_results: web.length, creator_count: channels.size, recent_video_count: videos.length, extracted_terms: terms, comparables: input.recommendations.slice(0, 8).map((item) => ({ name: item.name, reason: `${item.reason} Review against ${input.genre ?? "the game’s genre"} and the extracted terms ${terms.join(", ") || "from the description"}.` })), contradictions: warnings, source_diversity: new Set([...web.map((item) => new URL(item.url).hostname), ...channels]).size, signal_strength: web.length + videos.length >= 8 ? "high" as const : web.length + videos.length >= 3 ? "medium" as const : "low" as const, confidence: warnings.length ? "low" as const : "medium" as const };
    const evidence = [
      ...web.slice(0, 5).map((item) => createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "fact" as const, claim: `${item.title}: ${item.description.slice(0, 180)}`, source: { type: "brave_search", url: item.url, retrieved_at: observed, cache_key: null }, observation: { value: item.title, unit: "search_result", raw_ref: "raw/brave-direct-search.json" }, derivation: null, support_strength: "medium" as const, relationship: "contextualizes" as const, related_claim_ids: [], notes: "Search result relevance is not a measured coverage total.", used_by: ["orchestrator", "critic", "report"] })),
      ...videos.slice(0, 5).map((item) => createEvidence({ run_id: context.runId, module_id: "market-intelligence", kind: "fact" as const, claim: `${item.channelTitle} published “${item.title}” on ${item.publishedAt.slice(0, 10)}.`, source: { type: "youtube_api", url: `https://www.youtube.com/watch?v=${item.id}`, retrieved_at: observed, cache_key: null }, observation: { value: { published_at: item.publishedAt, channel: item.channelTitle, views: item.views, likes: item.likes, comments: item.comments }, unit: "video", raw_ref: "raw/youtube-direct-search.json" }, derivation: null, support_strength: "high" as const, relationship: "contextualizes" as const, related_claim_ids: [], notes: null, used_by: ["orchestrator", "critic", "report"] })),
    ];
    return { status: warnings.length ? "degraded" : "completed", output, evidence, suggested_next_steps: warnings.length ? ["Configure missing research providers for fuller coverage"] : ["Challenge creator concentration and post-update timing"], warnings, metrics: { duration_ms: 0, external_calls: Number(brave.available) + Number(youtube.available) * 2, estimated_cost_usd: 0 } };
  },
};
