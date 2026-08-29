import { z } from "zod";

export class ProviderError extends Error {
  constructor(public readonly provider: string, public readonly status: number | null, message: string, public readonly retryable: boolean) { super(message); }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal, headers: { "user-agent": "Cronoblox/0.1 public-game-audit" } });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === attempts - 1) throw new ProviderError("roblox", response.status, `Roblox returned ${response.status}`, retryable);
        await sleep(300 * (2 ** attempt));
        continue;
      }
      return schema.parse(await response.json());
    } catch (error) {
      last = error;
      if (error instanceof ProviderError && !error.retryable) throw error;
      if (attempt < attempts - 1) await sleep(300 * (2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new ProviderError("roblox", null, "Roblox request failed", true);
}

export function parsePlaceId(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("Enter a public Roblox game URL or numeric place ID."); }
  if (!/(^|\.)roblox\.com$/i.test(url.hostname)) throw new Error("The URL must be on roblox.com.");
  const match = url.pathname.match(/\/games\/(\d+)/i);
  if (!match?.[1]) throw new Error("The Roblox URL does not contain a place ID.");
  return match[1];
}

const universeSchema = z.object({ universeId: z.number().int().positive() });
const gameSchema = z.object({ data: z.array(z.object({
  id: z.number(), rootPlaceId: z.number(), name: z.string(), description: z.string().nullish(),
  creator: z.object({ id: z.number(), name: z.string(), type: z.string() }),
  created: z.string(), updated: z.string(), playing: z.number().nullish(), visits: z.number().nullish(),
  maxPlayers: z.number().nullish(), favoritedCount: z.number().nullish(), genre: z.string().nullish(), genre_l1: z.string().nullish(), genre_l2: z.string().nullish(),
})) });
const votesSchema = z.object({ data: z.array(z.object({ id: z.number(), upVotes: z.number().nullish(), downVotes: z.number().nullish() })) });
const recommendationSchema = z.object({ games: z.array(z.object({ universeId: z.number().optional(), id: z.number().optional(), name: z.string().optional(), rootPlaceId: z.number().optional(), playerCount: z.number().optional() })).default([]) }).passthrough();
const badgesSchema = z.object({ data: z.array(z.object({ id: z.number(), name: z.string(), description: z.string().nullish(), statistics: z.object({ awardedCount: z.number().optional(), pastDayAwardedCount: z.number().optional() }).partial().optional() })).default([]) });

export type RobloxCore = z.infer<typeof gameSchema>["data"][number] & { placeId: string; universeId: string; votes: z.infer<typeof votesSchema>["data"][number] | null; badges: z.infer<typeof badgesSchema>["data"]; recommendations: z.infer<typeof recommendationSchema>["games"] };

export class RobloxSource {
  async audit(input: string, signal: AbortSignal): Promise<{ core: RobloxCore; raw: Record<string, unknown>; calls: number; warnings: string[] }> {
    const placeId = parsePlaceId(input);
    const identityUrl = `https://apis.roblox.com/universes/v1/places/${placeId}/universe`;
    const identity = await fetchJson(identityUrl, universeSchema, signal);
    const universeId = String(identity.universeId);
    const coreUrl = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
    const coreResult = await fetchJson(coreUrl, gameSchema, signal);
    const game = coreResult.data[0];
    if (!game) throw new ProviderError("roblox", 404, "No public game record was returned.", false);
    if (String(game.rootPlaceId) !== placeId) throw new ProviderError("roblox", 409, "Resolved game identity did not match the submitted place.", false);
    const warnings: string[] = [];
    const settled = await Promise.allSettled([
      fetchJson(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`, votesSchema, signal),
      fetchJson(`https://badges.roblox.com/v1/universes/${universeId}/badges?limit=100&sortOrder=Desc`, badgesSchema, signal),
      fetchJson(`https://games.roblox.com/v1/games/recommendations/game/${universeId}?maxRows=12`, recommendationSchema, signal),
    ]);
    const votes = settled[0].status === "fulfilled" ? settled[0].value.data[0] ?? null : null;
    const badges = settled[1].status === "fulfilled" ? settled[1].value.data ?? [] : [];
    const recommendations = settled[2].status === "fulfilled" ? settled[2].value.games ?? [] : [];
    if (settled[0].status === "rejected") warnings.push("Vote data unavailable");
    if (settled[1].status === "rejected") warnings.push("Badge activity unavailable");
    if (settled[2].status === "rejected") warnings.push("Recommended peers unavailable");
    return { core: { ...game, placeId, universeId, votes, badges, recommendations }, raw: { identity, game: coreResult, votes: settled[0], badges: settled[1], recommendations: settled[2] }, calls: 5, warnings };
  }

  async searchPeers(query: string, signal: AbortSignal) {
    const url = new URL("https://apis.roblox.com/search-api/omni-search");
    url.searchParams.set("searchQuery", query); url.searchParams.set("pageType", "all");
    return fetchJson(url.toString(), z.record(z.unknown()), signal);
  }

  async getExploreSorts(signal: AbortSignal) {
    const url = "https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=cronoblox-evaluation&device=computer&country=US";
    return fetchJson(url, z.record(z.unknown()), signal);
  }

  async getExploreSortContent(sortId: string, signal: AbortSignal) {
    const url = new URL("https://apis.roblox.com/explore-api/v1/get-sort-content");
    url.searchParams.set("sessionId", "cronoblox-evaluation"); url.searchParams.set("sortId", sortId); url.searchParams.set("device", "computer"); url.searchParams.set("country", "US");
    return fetchJson(url.toString(), z.record(z.unknown()), signal);
  }
}
