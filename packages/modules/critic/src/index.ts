import { z } from "zod";
import { agentCallAllowance, createOpenRouterClient, runAgentLoop, withIterationCap, type AgentTool } from "@cronoblox/agent-core";
import { createEvidenceLookupTool, createFetchPageTool, emitAgentEvent, keepKnownIds, toToolRuntime } from "@cronoblox/agent-tools";
import { BreakoutPotentialSchema, CriticObjectionSchema, ThesisSchema, type Evidence } from "@cronoblox/contracts";
import type { CronobloxModule } from "@cronoblox/module-sdk";

export const CriticInputSchema = z.object({ thesis: ThesisSchema, evidence_ids: z.array(z.string()), source_failures: z.array(z.string()) });
export const CriticOutputSchema = z.object({ objections: z.array(CriticObjectionSchema), recommended_potential: BreakoutPotentialSchema.describe("The breakout potential the report should ship with after verification. Hold the orchestrator's rating when the evidence genuinely supports it; lower it when it does not. Never raise it."), summary: z.string().describe("2-3 sentences on your overall verification verdict and why — not a one-word placeholder, and not a wall of text.") });
export type CriticOutput = z.infer<typeof CriticOutputSchema>;

const SYSTEM = `You are the Cronoblox Critic, a falsification-minded verifier reviewing the orchestrator's thesis after the fact. Your job is to find reasons the thesis could be wrong, not to rubber-stamp it.
Check specifically: does every supporting/risk claim actually have evidence backing it (use get_evidence_by_id to inspect any claim's cited evidence)? Are there alternative, non-breakout explanations for the same numbers? Is source coverage (YouTube-only, no general web search in this run) actually adequate, or are there source_failures that mean the rating is not earned? You may use fetch_page to independently open a cited source URL and spot-check one or two specific claims if it would change your verdict — you don't have to use it.
Every objection's affected_claim_ids and evidence_ids must reference real ids from the thesis/evidence you were given — never invent one. Set recommended_potential to the rating the report should actually ship with: hold the orchestrator's rating when the evidence earns it, and lower it (LOW < MODERATE < HIGH < VERY HIGH) when it does not. Never raise it — you are a check on optimism, not a second opinion in its favour. A rating is not a probability, so do not hedge a well-evidenced rating just because the future is uncertain; downgrade only when a specific objection undercuts the evidence behind the rating.
Call submit_critique when done. severity "high" means the report should not ship as-is; "medium"/"low" are noted caveats that still allow shipping, usually at a lower potential.`;

const POTENTIAL_ORDER = ["LOW", "MODERATE", "HIGH", "VERY HIGH"] as const;
/** The critic may only hold or lower the orchestrator's rating, never raise it. */
export function clampPotential(recommended: z.infer<typeof BreakoutPotentialSchema>, thesis: z.infer<typeof BreakoutPotentialSchema>) {
  return POTENTIAL_ORDER.indexOf(recommended) > POTENTIAL_ORDER.indexOf(thesis) ? thesis : recommended;
}
function downgrade(potential: z.infer<typeof BreakoutPotentialSchema>, steps: number) {
  return POTENTIAL_ORDER[Math.max(0, POTENTIAL_ORDER.indexOf(potential) - steps)] ?? "LOW";
}

function staticCritique(input: z.infer<typeof CriticInputSchema>): CriticOutput {
  const unsupported = [...input.thesis.supporting_claims, ...input.thesis.risk_claims].filter((claim) => claim.evidence_ids.length === 0);
  const objections = [
    ...unsupported.map((claim, index) => ({ id: `obj_unsupported_${index}`, severity: "high" as const, summary: "A material claim has no evidence reference.", affected_claim_ids: [claim.id], evidence_ids: [], resolution_request: "Remove or support the claim.", resolved: false })),
    { id: "obj_snapshot", severity: "medium" as const, summary: "Current Roblox metrics are a snapshot and cannot establish persistence.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids.slice(0, 3), resolution_request: "Explicitly monitor persistence after the current update window before treating the rating as durable.", resolved: true },
    ...(input.source_failures.length ? [{ id: "obj_coverage", severity: "high" as const, summary: "External source coverage is incomplete.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids, resolution_request: "Lower the rating and expose the missing coverage.", resolved: true }] : []),
  ];
  const highSeverity = objections.filter((item) => item.severity === "high").length;
  const recommended = downgrade(input.thesis.breakout_potential, highSeverity > 0 ? 2 : objections.length ? 1 : 0);
  return { objections, recommended_potential: recommended, summary: objections.length ? "The core signal is plausible, but durability and source coverage do not yet earn the original rating." : "No material unsupported claim survived verification." };
}

export const criticModule: CronobloxModule<z.infer<typeof CriticInputSchema>, CriticOutput> = {
  manifest: { id: "critic", name: "Critic / Verifier", version: "2.1.0", required: false, phase: "verification", dependencies: ["roblox-data"], defaultConfig: { maxCycles: 2, maxIterations: 4 } },
  inputSchema: CriticInputSchema, outputSchema: CriticOutputSchema,
  async execute(input, context) {
    if (context.profile.fixture_mode) {
      return { status: "completed", output: staticCritique(input), evidence: [], suggested_next_steps: ["Monitor persistence after the update window"], warnings: [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const knownEvidence = await context.getEvidence();
    const knownEvidenceIds = new Set(knownEvidence.map((item) => item.id));
    const knownClaimIds = new Set([...input.thesis.supporting_claims, ...input.thesis.risk_claims].map((claim) => claim.id));

    const tools: AgentTool<any>[] = [createEvidenceLookupTool(knownEvidence)];
    const evidenceSink: Evidence[] = [];
    const runtime = toToolRuntime(context, "critic", evidenceSink);
    tools.push(createFetchPageTool(runtime));

    const client = createOpenRouterClient();
    const { result, degraded } = await runAgentLoop({
      client, model: context.profile.model, system: SYSTEM,
      userInput: { thesis: input.thesis, evidence_ids: input.evidence_ids, source_failures: input.source_failures },
      tools,
      submit: { name: "submit_critique", description: "Submit your final critique.", schema: CriticOutputSchema },
      budget: withIterationCap(context.budget, 4, agentCallAllowance(context.profile, "verify")),
      signal: context.signal,
      onEvent: (event) => emitAgentEvent(context, "critic", event),
    });

    const allKnownEvidenceIds = new Set([...knownEvidenceIds, ...evidenceSink.map((item) => item.id)]);
    const sanitized: CriticOutput = {
      ...result,
      recommended_potential: clampPotential(result.recommended_potential, input.thesis.breakout_potential),
      objections: result.objections.map((objection) => ({
        ...objection,
        affected_claim_ids: keepKnownIds(objection.affected_claim_ids, knownClaimIds),
        evidence_ids: keepKnownIds(objection.evidence_ids, allKnownEvidenceIds),
      })),
    };

    return { status: degraded ? "degraded" : "completed", output: sanitized, evidence: evidenceSink, suggested_next_steps: [], warnings: degraded ? ["The critic could not return a structured critique through tool calling and was salvaged from a plain-text reply."] : [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: null } };
  },
};
