import { describe, expect, it } from "vitest";
import { getProfile } from "@cronoblox/config";
import type { Evidence } from "@cronoblox/contracts";
import { FixtureAnalyst } from "@cronoblox/llm";
import { robloxDataModule } from "@cronoblox/module-roblox-data";
import { marketIntelligenceModule } from "@cronoblox/module-market-intelligence";
import { criticModule } from "@cronoblox/module-critic";
import type { ModuleContext } from "@cronoblox/module-sdk";

describe("complete deterministic worker loop", () => {
  it("collects Module 2 first, researches, synthesizes, and critiques without paid APIs", async () => {
    const evidence: Evidence[] = []; const artifacts: string[] = [];
    const context: ModuleContext = { runId: "11111111-1111-1111-1111-111111111111", profile: getProfile("demo-replay"), signal: new AbortController().signal, now: () => new Date("2026-08-29T12:00:00.000Z"), getEvidence: async () => evidence, saveRawArtifact: async (provider, key) => { artifacts.push(`${provider}:${key}`); }, emit: async () => undefined };
    const core = await robloxDataModule.execute({ game_url: "8737899170" }, context); evidence.push(...core.evidence);
    expect(core.output.name).toBe("Build A Boat Odyssey"); expect(evidence[0]?.module_id).toBe("roblox-data");
    const market = await marketIntelligenceModule.execute({ name: core.output.name, description: core.output.description, genre: core.output.genre, recommendation_count: core.output.recommendation_count, recommendations: core.output.recommendations }, context); evidence.push(...market.evidence);
    const analysis = await new FixtureAnalyst().createThesis({ game: core.output, evidence, mode: "developer", baseline: false });
    const critic = await criticModule.execute({ thesis: analysis.thesis, evidence_ids: evidence.map((item) => item.id), source_failures: market.warnings }, context);
    expect(market.output.creator_count).toBeGreaterThan(1); expect(analysis.thesis.breakout_potential).toBe("HIGH"); expect(critic.output.recommended_confidence).toBe("LOW"); expect(artifacts).toEqual(["roblox:core", "fixture:market"]);
  });
});
