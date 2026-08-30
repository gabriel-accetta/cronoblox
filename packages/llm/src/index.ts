import { ThesisSchema, type Evidence, type Thesis, type UserMode } from "@cronoblox/contracts";

export interface LlmUsage { input_tokens: number; output_tokens: number; estimated_cost_usd: number }

/**
 * Deterministic, keyless thesis generator used only by the `demo-replay` fixture profile.
 * Live runs go through the real tool-calling agent loop in `@cronoblox/agent-core` /
 * `@cronoblox/module-orchestrator` instead — there is no single-shot "analyst" call anymore.
 */
export class FixtureAnalyst {
  async createThesis(input: { evidence: Evidence[]; mode: UserMode }): Promise<{ thesis: Thesis; usage: LlmUsage; metadata: Record<string, unknown> }> {
    const support = input.evidence.filter((item) => item.relationship === "supports");
    const context = input.evidence.filter((item) => item.relationship === "contextualizes");
    const thesis = ThesisSchema.parse({
      breakout_potential: "HIGH", confidence: "HIGH", recommendation: input.mode === "developer" ? "Protect retention while testing whether post-update discovery persists." : "Watch closely and advance to deeper diligence only if attention persists beyond the update window.",
      supporting_claims: [
        { id: "cl_momentum", text: "The game combines a meaningful live audience with strong normalized approval.", evidence_ids: support.slice(0, 2).map((item) => item.id) },
        { id: "cl_diversity", text: "Recent attention is distributed across multiple creators rather than one obvious source.", evidence_ids: context.slice(-2).map((item) => item.id) },
      ],
      risk_claims: [
        { id: "cl_persistence", text: "The current snapshot does not establish durable growth after the latest update.", evidence_ids: input.evidence.slice(0, 2).map((item) => item.id) },
        { id: "cl_short_window", text: "External coverage is promising but observed over a short window.", evidence_ids: context.slice(-2).map((item) => item.id) },
      ],
    });
    return { thesis, usage: { input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 }, metadata: { provider: "deterministic-fixture", clearly_labeled: true } };
  }
}
