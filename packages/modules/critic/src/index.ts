import { z } from "zod";
import { CriticObjectionSchema, ThesisSchema } from "@cronoblox/contracts";
import type { CronobloxModule } from "@cronoblox/module-sdk";

export const CriticInputSchema = z.object({ thesis: ThesisSchema, evidence_ids: z.array(z.string()), source_failures: z.array(z.string()) });
export const CriticOutputSchema = z.object({ objections: z.array(CriticObjectionSchema), recommended_confidence: z.enum(["LOW", "MEDIUM", "HIGH"]), summary: z.string() });

export const criticModule: CronobloxModule<z.infer<typeof CriticInputSchema>, z.infer<typeof CriticOutputSchema>> = {
  manifest: { id: "critic", name: "Critic / Verifier", version: "1.0.0", required: false, phase: "verification", dependencies: ["roblox-data"], defaultConfig: { maxCycles: 2 } },
  inputSchema: CriticInputSchema, outputSchema: CriticOutputSchema,
  async execute(input, context) {
    const unsupported = [...input.thesis.supporting_claims, ...input.thesis.risk_claims].filter((claim) => claim.evidence_ids.length === 0);
    const objections = [
      ...unsupported.map((claim, index) => ({ id: `obj_unsupported_${index}`, severity: "high" as const, summary: "A material claim has no evidence reference.", affected_claim_ids: [claim.id], evidence_ids: [], resolution_request: "Remove or support the claim.", resolved: false })),
      { id: "obj_snapshot", severity: "medium" as const, summary: "Current Roblox metrics are a snapshot and cannot establish persistence.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids.slice(0, 3), resolution_request: "Lower confidence and explicitly monitor persistence after the current update window.", resolved: true },
      ...(input.source_failures.length ? [{ id: "obj_coverage", severity: "high" as const, summary: "External source coverage is incomplete.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids, resolution_request: "Reduce confidence and expose missing coverage.", resolved: true }] : []),
    ];
    const recommended = objections.some((item) => item.severity === "high") ? "LOW" : input.thesis.confidence === "HIGH" ? "MEDIUM" : input.thesis.confidence;
    return { status: "completed", output: { objections, recommended_confidence: recommended, summary: objections.length ? "The core signal is plausible, but durability and source coverage constrain confidence." : "No material unsupported claim survived verification." }, evidence: [], suggested_next_steps: ["Monitor persistence after the update window"], warnings: [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
  },
};
