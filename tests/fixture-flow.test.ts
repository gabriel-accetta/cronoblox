import { describe, expect, it } from "vitest";
import { createRunBudget } from "@cronoblox/agent-core";
import { getProfile } from "@cronoblox/config";
import type { Evidence } from "@cronoblox/contracts";
import { registry } from "@cronoblox/engine";
import { ModuleRunner, type ModuleContext, type ModuleResult } from "@cronoblox/module-sdk";
import type { RobloxDataOutput } from "@cronoblox/module-roblox-data";
import type { Thesis } from "@cronoblox/contracts";
import type { MarketOutput } from "@cronoblox/module-market-intelligence";
import type { CriticOutput } from "@cronoblox/module-critic";

describe("complete deterministic worker loop (demo-replay / fixture mode)", () => {
  it("collects roblox data first, delegates fixture research through the orchestrator, and critiques without paid APIs", async () => {
    const evidence: Evidence[] = [];
    const artifacts: string[] = [];
    const runId = "11111111-1111-1111-1111-111111111111";

    const moduleOutputs: Record<string, unknown> = {};
    const moduleWarnings: Record<string, string[]> = {};
    const runner: ModuleRunner = new ModuleRunner(registry, async (manifest, result: ModuleResult<unknown>) => { evidence.push(...result.evidence); moduleOutputs[manifest.id] = result.output; moduleWarnings[manifest.id] = result.warnings; });
    const context: ModuleContext = {
      runId, profile: getProfile("demo-replay"), signal: new AbortController().signal, now: () => new Date("2026-08-29T12:00:00.000Z"),
      getEvidence: async () => evidence,
      saveRawArtifact: async (provider, key) => { artifacts.push(`${provider}:${key}`); },
      emit: async () => undefined,
      budget: createRunBudget({ maxExternalCalls: 100, maxCostUsd: 100 }),
      runModule: (id, input) => runner.run(id, input, context),
    };

    const core = await runner.run<{ game_url: string }, RobloxDataOutput>("roblox-data", { game_url: "8737899170" }, context);
    expect(core.output.name).toBe("Build A Boat Odyssey");
    expect(evidence[0]?.module_id).toBe("roblox-data");

    const gameContext = { name: core.output.name, description: core.output.description, genre: core.output.genre, universe_id: core.output.universe_id, playing: core.output.playing, visits: core.output.visits, favorites: core.output.favorites, like_ratio: core.output.like_ratio, favorites_per_1000_visits: core.output.favorites_per_1000_visits };
    const orchestrated = await runner.run<unknown, Thesis>("orchestrator", { game: gameContext, user_mode: "developer", baseline: false, critic_feedback: [] }, context);

    const market = moduleOutputs["market-intelligence"] as MarketOutput | undefined;
    expect(market?.creator_count).toBeGreaterThan(1);

    const critic = await runner.run<unknown, CriticOutput>("critic", { thesis: orchestrated.output, evidence_ids: evidence.map((item) => item.id), source_failures: moduleWarnings["market-intelligence"] ?? [] }, context);

    expect(orchestrated.output.breakout_potential).toBe("HIGH");
    expect(critic.output.recommended_potential).toBe("LOW");
    expect(artifacts).toEqual(["roblox:core", "fixture:market"]);
  });
});
