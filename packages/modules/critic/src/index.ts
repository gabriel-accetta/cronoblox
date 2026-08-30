import { z } from "zod";
import { createOpenRouterClient, runAgentLoop, withIterationCap, type AgentTool } from "@cronoblox/agent-core";
import { createEvidenceLookupTool, createFetchPageTool, emitAgentEvent, keepKnownIds, toToolRuntime } from "@cronoblox/agent-tools";
import { CriticObjectionSchema, ThesisSchema, type Evidence } from "@cronoblox/contracts";
import type { CronobloxModule } from "@cronoblox/module-sdk";

export const CriticInputSchema = z.object({ thesis: ThesisSchema, evidence_ids: z.array(z.string()), source_failures: z.array(z.string()) });
export const CriticOutputSchema = z.object({ objections: z.array(CriticObjectionSchema), recommended_confidence: z.enum(["LOW", "MEDIUM", "HIGH"]), summary: z.string().describe("2-4 sentences on your overall verification verdict and why — not a one-word placeholder.") });
export type CriticOutput = z.infer<typeof CriticOutputSchema>;

const SYSTEM = `You are the Cronoblox Critic, a falsification-minded verifier reviewing the orchestrator's thesis after the fact. Your job is to find reasons the thesis could be wrong, not to rubber-stamp it.
Check specifically: does every supporting/risk claim actually have evidence backing it (use get_evidence_by_id to inspect any claim's cited evidence)? Are there alternative, non-breakout explanations for the same numbers? Is source coverage (YouTube-only, no general web search in this run) actually adequate, or are there source_failures that should lower confidence? You may use fetch_page to independently open a cited source URL and spot-check one or two specific claims if it would change your verdict — you don't have to use it.
Every objection's affected_claim_ids and evidence_ids must reference real ids from the thesis/evidence you were given — never invent one. Call submit_critique when done. severity "high" means the report should not ship as-is; "medium"/"low" are noted caveats that still allow shipping with reduced confidence.`;

function staticCritique(input: z.infer<typeof CriticInputSchema>): CriticOutput {
  const unsupported = [...input.thesis.supporting_claims, ...input.thesis.risk_claims].filter((claim) => claim.evidence_ids.length === 0);
  const objections = [
    ...unsupported.map((claim, index) => ({ id: `obj_unsupported_${index}`, severity: "high" as const, summary: "A material claim has no evidence reference.", affected_claim_ids: [claim.id], evidence_ids: [], resolution_request: "Remove or support the claim.", resolved: false })),
    { id: "obj_snapshot", severity: "medium" as const, summary: "Current Roblox metrics are a snapshot and cannot establish persistence.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids.slice(0, 3), resolution_request: "Lower confidence and explicitly monitor persistence after the current update window.", resolved: true },
    ...(input.source_failures.length ? [{ id: "obj_coverage", severity: "high" as const, summary: "External source coverage is incomplete.", affected_claim_ids: input.thesis.supporting_claims.map((claim) => claim.id), evidence_ids: input.evidence_ids, resolution_request: "Reduce confidence and expose missing coverage.", resolved: true }] : []),
  ];
  const recommended = objections.some((item) => item.severity === "high") ? "LOW" : input.thesis.confidence === "HIGH" ? "MEDIUM" : input.thesis.confidence;
  return { objections, recommended_confidence: recommended, summary: objections.length ? "The core signal is plausible, but durability and source coverage constrain confidence." : "No material unsupported claim survived verification." };
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
    const { result } = await runAgentLoop({
      client, model: context.profile.model, system: SYSTEM,
      userInput: { thesis: input.thesis, evidence_ids: input.evidence_ids, source_failures: input.source_failures },
      tools,
      submit: { name: "submit_critique", description: "Submit your final critique.", schema: CriticOutputSchema },
      budget: withIterationCap(context.budget, 4),
      signal: context.signal,
      onEvent: (event) => emitAgentEvent(context, "critic", event),
    });

    const allKnownEvidenceIds = new Set([...knownEvidenceIds, ...evidenceSink.map((item) => item.id)]);
    const sanitized: CriticOutput = {
      ...result,
      objections: result.objections.map((objection) => ({
        ...objection,
        affected_claim_ids: keepKnownIds(objection.affected_claim_ids, knownClaimIds),
        evidence_ids: keepKnownIds(objection.evidence_ids, allKnownEvidenceIds),
      })),
    };

    return { status: "completed", output: sanitized, evidence: evidenceSink, suggested_next_steps: [], warnings: [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: null } };
  },
};
