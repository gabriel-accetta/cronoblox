import type { Effort, ProfileSnapshot } from "@cronoblox/contracts";

const versions = { "roblox-data": "1.0.0", "data-agent": "1.0.0", orchestrator: "1.0.0", "market-intelligence": "2.1.0", critic: "2.1.0" };

function envNumber(name: string, fallback: number, { integer = false } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return integer ? Math.floor(parsed) : parsed;
}

/**
 * The ceilings for a single run, overridable per deployment. `CRONOBLOX_MAX_COST_USD` is the one
 * that actually protects the wallet: it is a hard ceiling that effort can lower but never raise.
 */
export const BASE_LIMITS = {
  max_iterations: envNumber("CRONOBLOX_MAX_ITERATIONS", 8, { integer: true }),
  max_runtime_ms: envNumber("CRONOBLOX_MAX_RUNTIME_MS", 600_000, { integer: true }),
  max_external_calls: envNumber("CRONOBLOX_MAX_EXTERNAL_CALLS", 18, { integer: true }),
  max_critic_cycles: envNumber("CRONOBLOX_MAX_CRITIC_CYCLES", 2, { integer: true }),
  max_cost_usd: envNumber("CRONOBLOX_MAX_COST_USD", 0.2),
  max_search_results: envNumber("CRONOBLOX_MAX_SEARCH_RESULTS", 8, { integer: true }),
};

/**
 * Effort scales the work, not the ceiling. Cost multipliers never exceed 1, so raising effort can
 * never raise the bill above `max_cost_usd` — it only spends the same allowance more aggressively.
 */
export const EFFORT_SCALING: Record<Effort, { calls: number; iterations: number; criticCycles: number; searchResults: number; cost: number }> = {
  low: { calls: 0.45, iterations: 0.5, criticCycles: 0, searchResults: 0.4, cost: 0.5 },
  medium: { calls: 1, iterations: 1, criticCycles: 1, searchResults: 1, cost: 1 },
  high: { calls: 1.5, iterations: 1.4, criticCycles: 2, searchResults: 1.5, cost: 1 },
};

export const EFFORT_LABELS: Record<Effort, { label: string; description: string }> = {
  low: { label: "Low", description: "Core data plus a quick look. Fewest searches, no critic revision cycles — cheapest and fastest." },
  medium: { label: "Medium", description: "Balanced delegation and one critic revision cycle." },
  high: { label: "High", description: "Widest research and up to two critic revision cycles, within the same cost ceiling." },
};

type Limits = ProfileSnapshot["limits"];

/** Applies an effort level to a profile's base limits. Every result stays a valid, positive limit. */
export function scaleLimits(limits: Limits, effort: Effort): Limits {
  const scale = EFFORT_SCALING[effort];
  return {
    max_iterations: Math.max(2, Math.round(limits.max_iterations * scale.iterations)),
    max_runtime_ms: limits.max_runtime_ms,
    max_external_calls: Math.max(2, Math.round(limits.max_external_calls * scale.calls)),
    max_critic_cycles: Math.min(limits.max_critic_cycles, scale.criticCycles) as Limits["max_critic_cycles"],
    max_cost_usd: Number((limits.max_cost_usd * Math.min(1, scale.cost)).toFixed(4)),
    max_search_results: Math.max(2, Math.round(limits.max_search_results * scale.searchResults)),
  };
}

const common = {
  // No "brave"/general web-search tool — see packages/modules/market-intelligence for why (dropped
  // after live-testing showed keyless web-scraping alternatives get blocked from server IPs).
  version: 1, enabled_tools: ["roblox", "youtube"], module_versions: versions,
  model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
  effort: "medium" as Effort,
  // Real tool-calling delegation (orchestrator -> data/socials agents -> critic, possibly across
  // revision cycles) runs multiple sequential LLM turns and is genuinely slower than the old
  // single-call pipeline — 4 minutes was sized for that and was cutting real runs off mid-flight.
  limits: BASE_LIMITS,
  search: { locale: "en-US", country: "US", device: "desktop" }, fixture_mode: false,
};

export const profiles: Record<string, ProfileSnapshot> = {
  baseline: { ...common, id: "baseline", label: "Baseline", description: "Current Roblox data plus one direct model assessment — the orchestrator has no sub-agents to delegate to.", enabled_modules: ["roblox-data", "orchestrator"], limits: { ...common.limits, max_iterations: 2, max_external_calls: 6, max_critic_cycles: 0 } },
  "research-no-critic": { ...common, id: "research-no-critic", label: "Research, no critic", description: "Orchestrator may delegate to the data and socials agents; no verification pass.", enabled_modules: ["roblox-data", "orchestrator", "data-agent", "market-intelligence"], limits: { ...common.limits, max_critic_cycles: 0 } },
  "hackathon-full": { ...common, id: "hackathon-full", label: "Hackathon full", description: "Complete P0 workflow: orchestrator delegates to real tool-using agents, with up to two critic revision cycles.", enabled_modules: ["roblox-data", "orchestrator", "data-agent", "market-intelligence", "critic"] },
  "demo-replay": { ...common, id: "demo-replay", label: "Demo replay", description: "Deterministic cached evidence; clearly labeled as fixture data.", enabled_modules: ["roblox-data", "orchestrator", "market-intelligence", "critic"], enabled_tools: ["fixture"], fixture_mode: true },
};

export function getProfile(id: string, effort: Effort = "medium"): ProfileSnapshot {
  const profile = profiles[id];
  if (!profile) throw new Error(`Unknown analysis profile: ${id}`);
  const snapshot = structuredClone(profile);
  return { ...snapshot, effort, limits: scaleLimits(snapshot.limits, effort) };
}
