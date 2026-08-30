import { z } from "zod";
import type { AgentTool } from "@cronoblox/agent-core";
import { createOpenRouterClient, runAgentLoop, withIterationCap } from "@cronoblox/agent-core";
import { emitAgentEvent, keepKnownIds } from "@cronoblox/agent-tools";
import { ThesisSchema, UserModeSchema, type Thesis } from "@cronoblox/contracts";
import { FixtureAnalyst } from "@cronoblox/llm";
import type { CronobloxModule, ModuleContext } from "@cronoblox/module-sdk";

const GameContextSchema = z.object({
  name: z.string(), description: z.string(), genre: z.string().nullable(), universe_id: z.string(),
  playing: z.number().nullable(), visits: z.number().nullable(), favorites: z.number().nullable(),
  like_ratio: z.number().nullable(), favorites_per_1000_visits: z.number().nullable(),
});

export const OrchestratorInputSchema = z.object({
  game: GameContextSchema,
  user_mode: UserModeSchema,
  baseline: z.boolean(),
  critic_feedback: z.array(z.object({ summary: z.string(), resolution_request: z.string() })),
});
export const OrchestratorOutputSchema = ThesisSchema;

const SYSTEM = `You are the Cronoblox Research Orchestrator. You are given an audited Roblox game's core platform data (already resolved, treat it as ground truth) and must produce a breakout-potential thesis for the given user mode (developer or investor).
You may delegate to two sub-agents, each callable zero or more times with a different focus each time: call_data_agent (deeper Roblox platform research: comparable games, trending charts) and call_socials_agent (web/YouTube research on real-world attention and creator diversity). Only delegate if you genuinely expect it to change your assessment — delegation costs budget. If the core data alone is already conclusive, delegate zero times and submit directly.
Every claim's evidence_ids must be real ids: either from core_evidence in your input, or from the "evidence" array returned inside a call_data_agent/call_socials_agent tool result. Never invent an id, a statistic, or a source. A current snapshot is not historical growth data — say so rather than treating missing history as negative.
If critic_feedback is present, this is a revision pass: address the specific objections (gather more evidence via delegation if that would resolve one, or adjust confidence/claims) rather than repeating the same thesis.
Call submit_thesis when you are done.`;

interface DelegateResult { status: string; output: unknown; warnings: string[]; evidence: Array<{ id: string; claim: string }> }

function createDelegateTool(context: ModuleContext, name: "call_data_agent" | "call_socials_agent", moduleId: "data-agent" | "market-intelligence", game: z.infer<typeof GameContextSchema>): AgentTool<{ focus: string }> {
  return {
    name,
    description: name === "call_data_agent" ? "Delegate to the Data Agent for deeper Roblox platform research on a specific focus." : "Delegate to the Socials Agent for web/YouTube research on a specific focus.",
    parameters: z.object({ focus: z.string().min(1) }),
    externalCalls: 1,
    async execute({ focus }) {
      const input = moduleId === "data-agent" ? { focus, game: { name: game.name, description: game.description, genre: game.genre, universe_id: game.universe_id } } : { focus, game: { name: game.name, description: game.description, genre: game.genre } };
      const result = await context.runModule<typeof input, unknown>(moduleId, input);
      const payload: DelegateResult = { status: result.status, output: result.output, warnings: result.warnings, evidence: result.evidence.map((item) => ({ id: item.id, claim: item.claim })) };
      return JSON.stringify(payload);
    },
  };
}

export const orchestratorModule: CronobloxModule<z.infer<typeof OrchestratorInputSchema>, Thesis> = {
  manifest: { id: "orchestrator", name: "Research Orchestrator", version: "1.0.0", required: true, phase: "core", dependencies: ["roblox-data"], defaultConfig: {} },
  inputSchema: OrchestratorInputSchema, outputSchema: OrchestratorOutputSchema,
  async execute(input, context) {
    if (context.profile.fixture_mode) {
      if (context.profile.enabled_modules.includes("market-intelligence")) {
        await context.runModule("market-intelligence", { focus: "fixture", game: { name: input.game.name, description: input.game.description, genre: input.game.genre } });
      }
      const allEvidence = await context.getEvidence();
      const { thesis } = await new FixtureAnalyst().createThesis({ evidence: allEvidence, mode: input.user_mode });
      return { status: "completed", output: thesis, evidence: [], suggested_next_steps: [], warnings: [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const coreEvidence = await context.getEvidence();
    const tools: AgentTool<any>[] = [];
    if (!input.baseline) {
      if (context.profile.enabled_modules.includes("data-agent")) tools.push(createDelegateTool(context, "call_data_agent", "data-agent", input.game));
      if (context.profile.enabled_modules.includes("market-intelligence")) tools.push(createDelegateTool(context, "call_socials_agent", "market-intelligence", input.game));
    }

    const client = createOpenRouterClient();
    const { result } = await runAgentLoop({
      client, model: context.profile.model, system: SYSTEM,
      userInput: {
        game: input.game, user_mode: input.user_mode,
        core_evidence: coreEvidence.map((item) => ({ id: item.id, claim: item.claim, relationship: item.relationship, support_strength: item.support_strength })),
        critic_feedback: input.critic_feedback,
      },
      tools,
      submit: { name: "submit_thesis", description: "Submit your final breakout-potential thesis.", schema: ThesisSchema },
      budget: withIterationCap(context.budget, context.profile.limits.max_iterations),
      signal: context.signal,
      onEvent: (event) => emitAgentEvent(context, "orchestrator", event),
    });

    const allEvidence = await context.getEvidence();
    const knownIds = new Set(allEvidence.map((item) => item.id));
    const sanitized: Thesis = {
      ...result,
      supporting_claims: result.supporting_claims.map((claim) => ({ ...claim, evidence_ids: keepKnownIds(claim.evidence_ids, knownIds) })),
      risk_claims: result.risk_claims.map((claim) => ({ ...claim, evidence_ids: keepKnownIds(claim.evidence_ids, knownIds) })),
    };

    return { status: "completed", output: sanitized, evidence: [], suggested_next_steps: [], warnings: [], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: null } };
  },
};
