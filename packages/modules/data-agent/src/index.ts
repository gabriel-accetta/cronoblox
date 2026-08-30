import { z } from "zod";
import { createOpenRouterClient, runAgentLoop, withIterationCap } from "@cronoblox/agent-core";
import { createRobloxChartGamesTool, createRobloxListChartsTool, createRobloxPeerSearchTool, emitAgentEvent, toToolRuntime, toolAvailability } from "@cronoblox/agent-tools";
import type { Evidence } from "@cronoblox/contracts";
import type { CronobloxModule } from "@cronoblox/module-sdk";

export const DataAgentInputSchema = z.object({
  focus: z.string().min(1),
  game: z.object({ name: z.string(), description: z.string(), genre: z.string().nullable(), universe_id: z.string() }),
});

export const DataAgentOutputSchema = z.object({
  summary: z.string().describe("2-4 sentences on what you found and why it matters for breakout potential — not a one-word placeholder."),
  comparables: z.array(z.object({ name: z.string(), universe_id: z.string().nullable(), reason: z.string() })).max(8),
});
export type DataAgentOutput = z.infer<typeof DataAgentOutputSchema>;

const SYSTEM = `You are the Cronoblox Data Agent, a sub-agent invoked by the research orchestrator to go deeper on Roblox platform data than the mandatory core audit already covers.
You have tools to search Roblox's catalog and read its current discovery/trending charts. Use them only if they would meaningfully inform breakout-potential analysis for the given focus — you decide how many calls, if any, are worth making. When done, call submit_data_findings with a short summary and any genuinely comparable games you found (do not repeat games already implied by the audited game's own name unless you found new confirming context). Never invent a game, statistic, or URL — only report what your tool calls actually returned.`;

export const dataAgentModule: CronobloxModule<z.infer<typeof DataAgentInputSchema>, DataAgentOutput> = {
  manifest: { id: "data-agent", name: "Data Agent (deep Roblox research)", version: "1.0.0", required: false, phase: "research", dependencies: ["roblox-data"], defaultConfig: { maxIterations: 4 } },
  inputSchema: DataAgentInputSchema,
  outputSchema: DataAgentOutputSchema,
  async execute(input, context) {
    if (context.profile.fixture_mode) {
      return { status: "skipped", output: { summary: "Data agent does not run in fixture/demo mode.", comparables: [] }, evidence: [], suggested_next_steps: [], warnings: ["Fixture mode — data agent skipped"], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const availability = toolAvailability(context.profile);
    const evidenceSink: Evidence[] = [];
    const runtime = toToolRuntime(context, "data-agent", evidenceSink);
    const tools = availability.roblox ? [createRobloxPeerSearchTool(runtime), createRobloxListChartsTool(runtime), createRobloxChartGamesTool(runtime)] : [];

    if (!tools.length) {
      return { status: "skipped", output: { summary: "No Roblox exploration tools were enabled for this profile.", comparables: [] }, evidence: [], suggested_next_steps: [], warnings: ["roblox tool disabled by profile"], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } };
    }

    const client = createOpenRouterClient();
    const { result, toolCallCount } = await runAgentLoop({
      client, model: context.profile.model, system: SYSTEM,
      userInput: { focus: input.focus, game: input.game },
      tools,
      submit: { name: "submit_data_findings", description: "Submit your final findings for this delegation.", schema: DataAgentOutputSchema },
      budget: withIterationCap(context.budget, 4),
      signal: context.signal,
      onEvent: (event) => emitAgentEvent(context, "data-agent", event),
    });

    return { status: "completed", output: result, evidence: evidenceSink, suggested_next_steps: [], warnings: [], metrics: { duration_ms: 0, external_calls: toolCallCount, estimated_cost_usd: null } };
  },
};
