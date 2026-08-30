import { z } from "zod";
import { createEvidence, deriveEvidence } from "@cronoblox/evidence";
import type { CronobloxModule } from "@cronoblox/module-sdk";
import { RobloxSource, type RobloxCore } from "@cronoblox/source-roblox";

export const RobloxDataInputSchema = z.object({ game_url: z.string().min(1) });
export const RobloxDataOutputSchema = z.object({
  place_id: z.string(), universe_id: z.string(), name: z.string(), description: z.string(), creator: z.string(),
  creator_id: z.string().nullable(), creator_type: z.string().nullable(), url: z.string(), creator_url: z.string().nullable(),
  icon_url: z.string().nullable(), thumbnails: z.array(z.string()),
  created_at: z.string(), updated_at: z.string(), playing: z.number().nullable(), visits: z.number().nullable(), favorites: z.number().nullable(),
  up_votes: z.number().nullable(), down_votes: z.number().nullable(), max_players: z.number().nullable(), genre: z.string().nullable(),
  like_ratio: z.number().nullable(), favorites_per_1000_visits: z.number().nullable(), votes_per_1000_visits: z.number().nullable(),
  estimated_active_servers: z.number().nullable(), past_day_badge_awards: z.number().nullable(), recommendation_count: z.number(),
  recommendations: z.array(z.object({ name: z.string(), universe_id: z.string().nullable(), player_count: z.number().nullable(), reason: z.string() })),
});
export type RobloxDataOutput = z.infer<typeof RobloxDataOutputSchema>;

const fixture: RobloxCore = {
  id: 4924922222, rootPlaceId: 8737899170, placeId: "8737899170", universeId: "4924922222", name: "Build A Boat Odyssey",
  description: "Build creative ships, cross dangerous waters, unlock new materials, and explore islands with friends.",
  creator: { id: 101, name: "Odyssey Works", type: "Group" }, created: "2025-11-04T12:00:00Z", updated: "2026-08-27T17:00:00Z",
  iconUrl: null, thumbnails: [],
  playing: 3821, visits: 12840000, maxPlayers: 12, favoritedCount: 418000, genre: "Adventure", genre_l1: "Adventure", genre_l2: "Exploration",
  votes: { id: 4924922222, upVotes: 187300, downVotes: 12400 },
  badges: [{ id: 1, name: "First Voyage", description: "Complete your first crossing", statistics: { pastDayAwardedCount: 6940 } }],
  recommendations: [
    { universeId: 537413528, name: "Build A Boat For Treasure", playerCount: 32000 },
    { universeId: 994732206, name: "Plane Crazy", playerCount: 8900 },
    { universeId: 383310974, name: "Theme Park Tycoon 2", playerCount: 11500 },
  ],
};

function metric(a: number | null | undefined, b: number | null | undefined, multiplier = 1) { return a == null || b == null || b === 0 ? null : (a / b) * multiplier; }

/** Public profile URL for whoever publishes the game. Groups and users live on different Roblox paths. */
export function creatorProfileUrl(creator: { id: number | null; type: string | null }): string | null {
  if (creator.id == null) return null;
  if (/group|community/i.test(creator.type ?? "")) return `https://www.roblox.com/communities/${creator.id}`;
  return `https://www.roblox.com/users/${creator.id}/profile`;
}

export const robloxDataModule: CronobloxModule<z.infer<typeof RobloxDataInputSchema>, RobloxDataOutput> = {
  manifest: { id: "roblox-data", name: "Roblox Data Audit", version: "1.0.0", required: true, phase: "core", dependencies: [], defaultConfig: { timeoutMs: 15_000, retries: 2 } },
  inputSchema: RobloxDataInputSchema,
  outputSchema: RobloxDataOutputSchema,
  async execute(input, context) {
    const source = new RobloxSource();
    const audited = context.profile.fixture_mode ? { core: fixture, raw: { fixture: true, core: fixture }, calls: 0, warnings: ["Cached fixture data — not a live audit"] } : await source.audit(input.game_url, context.signal);
    await context.saveRawArtifact("roblox", "core", audited.raw);
    const core = audited.core;
    const observed = context.now().toISOString();
    const url = `https://www.roblox.com/games/${core.placeId}`;
    const sourceUrl = `https://games.roblox.com/v1/games?universeIds=${core.universeId}`;
    const base = [
      createEvidence({ run_id: context.runId, module_id: "roblox-data", kind: "fact", claim: `Identity resolved to ${core.name} by ${core.creator.name}.`, source: { type: context.profile.fixture_mode ? "fixture" : "roblox_api", url: sourceUrl, retrieved_at: observed, cache_key: `roblox-core:${core.universeId}` }, observation: { value: { place_id: core.placeId, universe_id: core.universeId, name: core.name, creator: core.creator.name }, unit: null, raw_ref: "raw/roblox-core.json" }, derivation: null, support_strength: "high", relationship: "contextualizes", related_claim_ids: [], notes: `Public game: ${url}`, used_by: ["orchestrator", "critic", "report"] }),
      createEvidence({ run_id: context.runId, module_id: "roblox-data", kind: "fact", claim: `The game had ${core.playing?.toLocaleString() ?? "unknown"} concurrent players when observed.`, source: { type: context.profile.fixture_mode ? "fixture" : "roblox_api", url: sourceUrl, retrieved_at: observed, cache_key: `roblox-core:${core.universeId}` }, observation: { value: core.playing ?? null, unit: "concurrent_players", raw_ref: "raw/roblox-core.json" }, derivation: null, support_strength: "high", relationship: "supports", related_claim_ids: [], notes: "Current snapshot only; not historical growth.", used_by: ["orchestrator", "critic", "report"] }),
      createEvidence({ run_id: context.runId, module_id: "roblox-data", kind: "fact", claim: `Lifetime reach is ${core.visits?.toLocaleString() ?? "unknown"} visits and ${core.favoritedCount?.toLocaleString() ?? "unknown"} favorites.`, source: { type: context.profile.fixture_mode ? "fixture" : "roblox_api", url: sourceUrl, retrieved_at: observed, cache_key: `roblox-core:${core.universeId}` }, observation: { value: { visits: core.visits ?? null, favorites: core.favoritedCount ?? null }, unit: "counts", raw_ref: "raw/roblox-core.json" }, derivation: null, support_strength: "high", relationship: "contextualizes", related_claim_ids: [], notes: null, used_by: ["orchestrator", "critic", "report"] }),
    ];
    const up = core.votes?.upVotes ?? null; const down = core.votes?.downVotes ?? null; const totalVotes = up == null || down == null ? null : up + down;
    const likeRatio = metric(up, totalVotes); const favoriteRate = metric(core.favoritedCount, core.visits, 1000); const voteRate = metric(totalVotes, core.visits, 1000);
    const derived = [
      ...(likeRatio == null ? [] : [deriveEvidence({ runId: context.runId, moduleId: "roblox-data", claim: `The observed like ratio was ${(likeRatio * 100).toFixed(1)}%.`, value: likeRatio, unit: "ratio", method: "Normalized vote calculation", formula: "up_votes / (up_votes + down_votes)", from: base })]),
      ...(favoriteRate == null ? [] : [deriveEvidence({ runId: context.runId, moduleId: "roblox-data", claim: `The game had ${favoriteRate.toFixed(1)} favorites per 1,000 visits.`, value: favoriteRate, unit: "favorites_per_1000_visits", method: "Normalized engagement calculation", formula: "favorites / visits * 1000", from: base })]),
    ];
    const pastDayBadgeAwards = core.badges.reduce((sum, badge) => sum + (badge.statistics?.pastDayAwardedCount ?? 0), 0) || null;
    const output: RobloxDataOutput = { place_id: core.placeId, universe_id: core.universeId, name: core.name, description: core.description ?? "", creator: core.creator.name, creator_id: core.creator.id == null ? null : String(core.creator.id), creator_type: core.creator.type ?? null, url, creator_url: creatorProfileUrl({ id: core.creator.id ?? null, type: core.creator.type ?? null }), icon_url: core.iconUrl ?? null, thumbnails: core.thumbnails ?? [], created_at: core.created, updated_at: core.updated, playing: core.playing ?? null, visits: core.visits ?? null, favorites: core.favoritedCount ?? null, up_votes: up, down_votes: down, max_players: core.maxPlayers ?? null, genre: core.genre_l2 ?? core.genre_l1 ?? core.genre ?? null, like_ratio: likeRatio, favorites_per_1000_visits: favoriteRate, votes_per_1000_visits: metric(totalVotes, core.visits, 1000), estimated_active_servers: core.playing && core.maxPlayers ? Math.ceil(core.playing / core.maxPlayers) : null, past_day_badge_awards: pastDayBadgeAwards, recommendation_count: core.recommendations.length, recommendations: core.recommendations.filter((item) => item.name).map((item) => ({ name: item.name!, universe_id: item.universeId == null ? null : String(item.universeId), player_count: item.playerCount ?? null, reason: "Seeded by the audited game’s Roblox recommendation graph; retained as a candidate comparable, not assumed identical." })) };
    const status = audited.warnings.length ? "degraded" : "completed";
    return { status, output, evidence: [...base, ...derived], suggested_next_steps: ["Research recent direct coverage", "Explain recommended comparable games"], warnings: audited.warnings, metrics: { duration_ms: 0, external_calls: audited.calls, estimated_cost_usd: 0 } };
  },
};
