import type { ProfileSnapshot } from "@cronoblox/contracts";

const versions = { "roblox-data": "1.0.0", "data-agent": "1.0.0", orchestrator: "1.0.0", "market-intelligence": "2.1.0", critic: "2.1.0" };
const common = {
  // No "brave"/general web-search tool — see packages/modules/market-intelligence for why (dropped
  // after live-testing showed keyless web-scraping alternatives get blocked from server IPs).
  version: 1, enabled_tools: ["roblox", "youtube"], module_versions: versions,
  model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
  // Real tool-calling delegation (orchestrator -> data/socials agents -> critic, possibly across
  // revision cycles) runs multiple sequential LLM turns and is genuinely slower than the old
  // single-call pipeline — 4 minutes was sized for that and was cutting real runs off mid-flight.
  limits: { max_iterations: 8, max_runtime_ms: 600_000, max_external_calls: 18, max_critic_cycles: 2 as const, max_cost_usd: 1.5 },
  search: { locale: "en-US", country: "US", device: "desktop" }, fixture_mode: false,
};

export const profiles: Record<string, ProfileSnapshot> = {
  baseline: { ...common, id: "baseline", label: "Baseline", description: "Current Roblox data plus one direct model assessment — the orchestrator has no sub-agents to delegate to.", enabled_modules: ["roblox-data", "orchestrator"], limits: { ...common.limits, max_iterations: 2, max_external_calls: 6, max_critic_cycles: 0 } },
  "research-no-critic": { ...common, id: "research-no-critic", label: "Research, no critic", description: "Orchestrator may delegate to the data and socials agents; no verification pass.", enabled_modules: ["roblox-data", "orchestrator", "data-agent", "market-intelligence"], limits: { ...common.limits, max_critic_cycles: 0 } },
  "hackathon-full": { ...common, id: "hackathon-full", label: "Hackathon full", description: "Complete P0 workflow: orchestrator delegates to real tool-using agents, with up to two critic revision cycles.", enabled_modules: ["roblox-data", "orchestrator", "data-agent", "market-intelligence", "critic"] },
  "demo-replay": { ...common, id: "demo-replay", label: "Demo replay", description: "Deterministic cached evidence; clearly labeled as fixture data.", enabled_modules: ["roblox-data", "orchestrator", "market-intelligence", "critic"], enabled_tools: ["fixture"], fixture_mode: true },
};

export function getProfile(id: string): ProfileSnapshot {
  const profile = profiles[id];
  if (!profile) throw new Error(`Unknown analysis profile: ${id}`);
  return structuredClone(profile);
}
