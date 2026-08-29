import type { ProfileSnapshot } from "@cronoblox/contracts";

const versions = { "roblox-data": "1.0.0", "market-intelligence": "1.0.0", critic: "1.0.0" };
const common = {
  version: 1, enabled_tools: ["roblox", "brave", "youtube"], module_versions: versions,
  model: process.env.OPENROUTER_MODEL ?? "openai/gpt-5-mini",
  limits: { max_iterations: 8, max_runtime_ms: 240_000, max_external_calls: 18, max_critic_cycles: 2 as const, max_cost_usd: 1.5 },
  search: { locale: "en-US", country: "US", device: "desktop" }, fixture_mode: false,
};

export const profiles: Record<string, ProfileSnapshot> = {
  baseline: { ...common, id: "baseline", label: "Baseline", description: "Current Roblox data plus one direct model assessment.", enabled_modules: ["roblox-data"], limits: { ...common.limits, max_iterations: 2, max_external_calls: 6, max_critic_cycles: 0 } },
  "research-no-critic": { ...common, id: "research-no-critic", label: "Research, no critic", description: "Platform, market, social, and comparable research without verification.", enabled_modules: ["roblox-data", "market-intelligence"], limits: { ...common.limits, max_critic_cycles: 0 } },
  "hackathon-full": { ...common, id: "hackathon-full", label: "Hackathon full", description: "Complete P0 workflow with evidence, research, and up to two critic cycles.", enabled_modules: ["roblox-data", "market-intelligence", "critic"] },
  "demo-replay": { ...common, id: "demo-replay", label: "Demo replay", description: "Deterministic cached evidence; clearly labeled as fixture data.", enabled_modules: ["roblox-data", "market-intelligence", "critic"], enabled_tools: ["fixture"], fixture_mode: true },
};

export function getProfile(id: string): ProfileSnapshot {
  const profile = profiles[id];
  if (!profile) throw new Error(`Unknown analysis profile: ${id}`);
  return structuredClone(profile);
}
