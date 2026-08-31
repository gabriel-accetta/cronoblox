import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentModelError, createRunBudget, runAgentLoop } from "@cronoblox/agent-core";
import { getProfile } from "@cronoblox/config";
import { createEvidence } from "@cronoblox/evidence";
import { criticModule } from "@cronoblox/module-critic";
import type { ModuleContext } from "@cronoblox/module-sdk";

vi.mock("@cronoblox/agent-core", async (original) => ({ ...await original<typeof import("@cronoblox/agent-core")>(), runAgentLoop: vi.fn(), createOpenRouterClient: vi.fn(() => ({})) }));

const evidence = createEvidence({ run_id: "critic-test", module_id: "roblox-data", kind: "fact", claim: "100 players at observation time.", source: { type: "roblox", url: "https://games.roblox.com/v1/games", retrieved_at: "2026-08-31T10:00:00.000Z", cache_key: null }, observation: { value: 100, unit: "players", raw_ref: null }, derivation: null, support_strength: "high", relationship: "supports", related_claim_ids: [], notes: "Snapshot only.", used_by: ["critic"] });
const thesis = { breakout_potential: "HIGH" as const, verdict_line: "Promising snapshot.", recommendation: "Monitor persistence.", supporting_claims: [{ id: "c1", text: "100 players.", evidence_ids: [evidence.id] }], risk_claims: [] };
const input = { thesis, evidence_ids: [evidence.id], source_failures: [] };
function context(): ModuleContext {
  return { runId: "critic-test", profile: getProfile("full"), signal: new AbortController().signal, now: () => new Date(), getEvidence: async () => [evidence], saveRawArtifact: vi.fn(), emit: vi.fn(), budget: createRunBudget({ maxExternalCalls: 18, maxCostUsd: 0.2 }), runModule: vi.fn() };
}

describe("critic verification recovery", () => {
  afterEach(() => vi.clearAllMocks());

  it("supplies full cited records immediately so the critic need not spend a turn requesting them", async () => {
    vi.mocked(runAgentLoop).mockResolvedValue({ result: { summary: "Snapshot verified.", objections: [], recommended_potential: "VERY HIGH" }, degraded: false, iterations: 1, toolCallCount: 0 });
    const result = await criticModule.execute(input, context());
    expect(vi.mocked(runAgentLoop).mock.calls[0]?.[0]).toMatchObject({ userInput: { cited_evidence: [evidence] }, recoverOnModelError: false });
    expect(result.status).toBe("completed");
    expect(result.output.recommended_potential).toBe("HIGH");
  });

  it("preserves the thesis and marks verification failed without fabricating a critique", async () => {
    vi.mocked(runAgentLoop).mockRejectedValue(new AgentModelError("timeout", "Model timed out after 90s on turn 2."));
    const result = await criticModule.execute(input, context());
    expect(result).toMatchObject({ status: "failed", output: { objections: [], recommended_potential: "HIGH" } });
    expect(result.output.summary).toContain("unverified");
    expect(result.warnings[0]).toContain("90s");
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("never treats a run abort or programming error as an incomplete provider review", async () => {
    const failure = new Error("Unexpected invariant violation");
    vi.mocked(runAgentLoop).mockRejectedValue(failure);
    await expect(criticModule.execute(input, context())).rejects.toBe(failure);
    const controller = new AbortController(); const reason = new Error("Run deadline"); controller.abort(reason);
    vi.mocked(runAgentLoop).mockRejectedValue(new AgentModelError("timeout", "Individual timeout"));
    await expect(criticModule.execute(input, { ...context(), signal: controller.signal })).rejects.toBe(reason);
  });
});
