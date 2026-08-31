import { z } from "zod";

export const RunStateSchema = z.enum([
  "QUEUED", "COLLECT_CORE", "PLAN", "EXECUTE", "RECORD", "SYNTHESIZE",
  "CRITIQUE", "ROUTE", "FINALIZE", "COMPLETED", "FAILED", "CANCELLED",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const ModuleStatusSchema = z.enum(["completed", "degraded", "skipped", "failed"]);
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  module_id: z.string().min(1),
  kind: z.enum(["fact", "inference", "recommendation"]),
  claim: z.string().min(1),
  source: z.object({
    type: z.string().min(1),
    url: z.string().url().nullable(),
    retrieved_at: z.string().datetime(),
    cache_key: z.string().nullable(),
  }),
  observation: z.object({
    value: z.unknown(),
    unit: z.string().nullable(),
    raw_ref: z.string().nullable(),
  }).nullable(),
  derivation: z.object({
    method: z.string().min(1),
    formula: z.string().nullable(),
    derived_from: z.array(z.string()).min(1),
  }).nullable(),
  support_strength: z.enum(["low", "medium", "high"]),
  relationship: z.enum(["supports", "contradicts", "contextualizes", "unresolved"]),
  related_claim_ids: z.array(z.string()),
  notes: z.string().nullable(),
  used_by: z.array(z.enum(["orchestrator", "critic", "report"])),
  supersedes_id: z.string().nullable().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Self-contained public tool results. They are observations, never worker reports. */
export const PublicToolResultSchema = z.object({
  status: z.enum(["completed", "degraded"]),
  observed_at: z.string().datetime(),
  data: z.record(z.unknown()),
  evidence: z.array(EvidenceSchema),
  warnings: z.array(z.string()),
  cached: z.boolean(),
  model_calls: z.literal(0),
});
export type PublicToolResult = z.infer<typeof PublicToolResultSchema>;

export const ModuleMetricsSchema = z.object({
  duration_ms: z.number().nonnegative(),
  external_calls: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative().nullable(),
});

export const ModuleResultSchema = <T extends z.ZodType>(output: T) => z.object({
  status: ModuleStatusSchema,
  output,
  evidence: z.array(EvidenceSchema),
  suggested_next_steps: z.array(z.string()),
  warnings: z.array(z.string()),
  metrics: ModuleMetricsSchema,
});

export const UserModeSchema = z.enum(["developer", "investor"]);
export type UserMode = z.infer<typeof UserModeSchema>;

/**
 * How hard the whole system works on one run. The profile decides *which* modules run; effort
 * decides how much budget, how many turns, and how wide a search each of them gets.
 */
export const EffortSchema = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof EffortSchema>;

export const AnalysisInputSchema = z.object({
  game_url: z.string().min(1),
  user_mode: UserModeSchema,
  profile_id: z.string().min(1),
  effort: EffortSchema.default("medium"),
  optional_modules: z.array(z.string()).default([]),
});
export type AnalysisInput = z.infer<typeof AnalysisInputSchema>;

export const ProfileSnapshotSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  label: z.string(),
  description: z.string(),
  enabled_modules: z.array(z.string()),
  enabled_tools: z.array(z.string()),
  module_versions: z.record(z.string(), z.string()),
  model: z.string(),
  /** Explicit model reasoning when supported; omitted on legacy/unknown model snapshots. */
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  effort: EffortSchema.default("medium"),
  limits: z.object({
    max_iterations: z.number().int().positive(),
    max_runtime_ms: z.number().int().positive(),
    max_external_calls: z.number().int().positive(),
    max_critic_cycles: z.number().int().min(0).max(2),
    max_cost_usd: z.number().positive(),
    /** How many results a search tool keeps per call — the main lever on how much a search costs downstream. */
    max_search_results: z.number().int().positive().default(8),
  }),
  search: z.object({ locale: z.string(), country: z.string(), device: z.string() }),
  fixture_mode: z.boolean().default(false),
});
export type ProfileSnapshot = z.infer<typeof ProfileSnapshotSchema>;

export const BreakoutPotentialSchema = z.enum(["LOW", "MODERATE", "HIGH", "VERY HIGH"]);
export type BreakoutPotential = z.infer<typeof BreakoutPotentialSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  evidence_ids: z.array(z.string()),
});

export const ThesisSchema = z.object({
  breakout_potential: BreakoutPotentialSchema,
  verdict_line: z.string().describe("One sentence, max ~140 characters, stating why this rating and nothing else. Shown next to the rating — it must read on its own."),
  recommendation: z.string().describe("The single most valuable next move for this user mode. At most 3 sentences, plain prose, no numbered lists."),
  supporting_claims: z.array(ClaimSchema).describe("Each claim text is one sentence a reader can scan — the evidence carries the detail, not the sentence."),
  risk_claims: z.array(ClaimSchema),
});
export type Thesis = z.infer<typeof ThesisSchema>;

export const CriticObjectionSchema = z.object({
  id: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  affected_claim_ids: z.array(z.string()),
  evidence_ids: z.array(z.string()),
  resolution_request: z.string(),
  resolved: z.boolean(),
});
export type CriticObjection = z.infer<typeof CriticObjectionSchema>;

export const ReportSchema = z.object({
  run_id: z.string(),
  game: z.object({
    name: z.string(), place_id: z.string(), universe_id: z.string(),
    creator: z.string(), creator_id: z.string().nullable(), creator_type: z.string().nullable(),
    url: z.string().url(), creator_url: z.string().url().nullable(),
    observed_at: z.string().datetime(),
    icon_url: z.string().url().nullable(), thumbnail_url: z.string().url().nullable(),
    thumbnails: z.array(z.string().url()).default([]),
  }),
  user_mode: UserModeSchema,
  verdict: ThesisSchema.pick({ breakout_potential: true, verdict_line: true, recommendation: true }),
  initial_verdict: ThesisSchema.pick({ breakout_potential: true }),
  audit_cards: z.array(z.object({
    module_id: z.string(), label: z.string(), status: ModuleStatusSchema,
    summary: z.string(), evidence_ids: z.array(z.string()), warnings: z.array(z.string()),
  })),
  supporting_claims: z.array(ClaimSchema),
  risk_claims: z.array(ClaimSchema),
  critic: z.object({ changed_assessment: z.boolean(), summary: z.string(), objections: z.array(CriticObjectionSchema), verification_status: z.enum(["completed", "incomplete", "disabled"]).optional() }),
  next_action: z.string(),
  monitor: z.array(z.string()),
  limitations: z.array(z.string()),
  source_failures: z.array(z.string()),
  runtime_ms: z.number().nonnegative(),
  approximate_cost_usd: z.number().nonnegative(),
  evidence_ids: z.array(z.string()),
  is_fixture: z.boolean(),
});
export type Report = z.infer<typeof ReportSchema>;

export const RunEventSchema = z.object({
  id: z.string(), run_id: z.string(), sequence: z.number().int().nonnegative(),
  state: RunStateSchema, level: z.enum(["info", "warning", "error"]),
  event_type: z.string(), message: z.string(), data: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunSummarySchema = z.object({
  id: z.string(), input: AnalysisInputSchema, state: RunStateSchema,
  game_name: z.string().nullable(), universe_id: z.string().nullable(),
  profile_snapshot: ProfileSnapshotSchema, error: z.string().nullable(),
  created_at: z.string().datetime(), updated_at: z.string().datetime(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const CreateRunResponseSchema = z.object({ run_id: z.string(), state: RunStateSchema });
export const RunDetailResponseSchema = z.object({ run: RunSummarySchema, events: z.array(RunEventSchema), report: ReportSchema.nullable() });

export function assertReportEvidence(report: Report, evidence: readonly Evidence[]) {
  const ids = new Set(evidence.map((item) => item.id));
  const referenced = [
    ...report.evidence_ids,
    ...report.supporting_claims.flatMap((item) => item.evidence_ids),
    ...report.risk_claims.flatMap((item) => item.evidence_ids),
    ...report.audit_cards.flatMap((item) => item.evidence_ids),
  ];
  const invalid = referenced.filter((id) => !ids.has(id));
  if (invalid.length) throw new Error(`Report references missing evidence: ${[...new Set(invalid)].join(", ")}`);
}
