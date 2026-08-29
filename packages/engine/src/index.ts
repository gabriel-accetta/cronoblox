import { assertReportEvidence, ReportSchema, type Evidence, type Report, type RunState, type Thesis } from "@cronoblox/contracts";
import { addRunEvent, appendEvidence, getRunRow, listRunEvidence, saveModuleResult, saveRawArtifact, saveReport, updateRunState } from "@cronoblox/db";
import { FixtureAnalyst, OpenRouterAnalyst, type AnalystLlm } from "@cronoblox/llm";
import { ModuleRegistry, ModuleRunner, type ModuleContext, type ModuleResult } from "@cronoblox/module-sdk";
import { robloxDataModule, type RobloxDataOutput } from "@cronoblox/module-roblox-data";
import { marketIntelligenceModule } from "@cronoblox/module-market-intelligence";
import { criticModule } from "@cronoblox/module-critic";
import { evaluateStoppingRule } from "./stopping";
export { evaluateStoppingRule } from "./stopping";

export const registry = new ModuleRegistry().register(robloxDataModule).register(marketIntelligenceModule).register(criticModule);
export const P0_EXECUTION_ORDER = ["roblox-data", "market-intelligence", "synthesis", "critic", "finalize"] as const;

export interface EngineHooks { onState?(state: RunState): void | Promise<void>; llm?: AnalystLlm }

export async function executeRun(runId: string, hooks: EngineHooks = {}) {
  const run = await getRunRow(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.state === "COMPLETED") return;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Run exceeded its runtime budget")), run.profileSnapshot.limits.max_runtime_ms);
  let activeState: RunState = "COLLECT_CORE";
  const move = async (state: RunState, message: string, level: "info" | "warning" | "error" = "info", data: Record<string, unknown> = {}) => {
    activeState = state; await updateRunState(runId, state, { started: state === "COLLECT_CORE" }); await addRunEvent(runId, state, level, `state.${state.toLowerCase()}`, message, data); await hooks.onState?.(state);
  };
  const context: ModuleContext = {
    runId, profile: run.profileSnapshot, signal: controller.signal, now: () => new Date(), getEvidence: () => listRunEvidence(runId),
    saveRawArtifact: (provider, key, payload) => saveRawArtifact(runId, provider, key, payload),
    emit: (level, type, message, data = {}) => addRunEvent(runId, activeState, level, type, message, data),
  };
  const runner = new ModuleRunner(registry, async (manifest, result: ModuleResult<unknown>) => {
    await saveModuleResult(runId, manifest.id, manifest.version, result); await appendEvidence(runId, result.evidence);
  });

  try {
    await move("COLLECT_CORE", "Resolving game identity and collecting current Roblox evidence");
    // Enforced by code: no planner or optional module executes before this mandatory call.
    const core = await runner.run<{ game_url: string }, RobloxDataOutput>("roblox-data", { game_url: run.input.game_url }, context);
    await updateRunState(runId, "COLLECT_CORE", { gameName: core.output.name, placeId: core.output.place_id, universeId: core.output.universe_id });
    await addRunEvent(runId, "COLLECT_CORE", core.status === "degraded" ? "warning" : "info", "module.roblox-data.completed", `${core.output.name} resolved and validated`, { status: core.status, evidence_count: core.evidence.length });

    if ((await getRunRow(runId))?.state === "CANCELLED") return;
    await move("PLAN", "Selecting the highest-value enabled research question");
    const sourceFailures = [...core.warnings];
    let market: Awaited<ReturnType<typeof marketIntelligenceModule.execute>> | null = null;
    if (run.profileSnapshot.enabled_modules.includes("market-intelligence")) {
      await move("EXECUTE", "Researching direct attention, themes, and comparable games");
      market = await runner.run("market-intelligence", { name: core.output.name, description: core.output.description, genre: core.output.genre, recommendation_count: core.output.recommendation_count, recommendations: core.output.recommendations }, context);
      sourceFailures.push(...market.warnings);
      await addRunEvent(runId, "EXECUTE", market.status === "degraded" ? "warning" : "info", "module.market-intelligence.completed", market.status === "degraded" ? "Market research completed with reduced coverage" : "Market and comparable research completed", { status: market.status, evidence_count: market.evidence.length });
    } else {
      sourceFailures.push("Market-intelligence module disabled by the saved profile");
      await saveModuleResult(runId, "market-intelligence", "1.0.0", { status: "skipped", output: {}, warnings: ["Disabled by analysis profile"], metrics: { duration_ms: 0, external_calls: 0, estimated_cost_usd: 0 } });
    }

    await move("RECORD", "Normalizing and validating evidence before synthesis");
    const captured = await listRunEvidence(runId);
    const llm = hooks.llm ?? (run.profileSnapshot.fixture_mode ? new FixtureAnalyst() : new OpenRouterAnalyst(run.profileSnapshot.model));
    await move("SYNTHESIZE", run.profileSnapshot.id === "baseline" ? "Running the single-pass baseline assessment" : "Forming the initial evidence-linked thesis");
    const initial = await llm.createThesis({ game: core.output, evidence: captured, mode: run.input.user_mode, baseline: run.profileSnapshot.id === "baseline" });
    await saveRawArtifact(runId, "openrouter", "initial-thesis-metadata", initial.metadata);
    let finalThesis: Thesis = initial.thesis;
    let critic: Awaited<ReturnType<typeof criticModule.execute>> | null = null;

    if (run.profileSnapshot.enabled_modules.includes("critic")) {
      await move("CRITIQUE", "Challenging the initial thesis for unsupported claims and alternative explanations");
      critic = await runner.run("critic", { thesis: initial.thesis, evidence_ids: captured.map((item) => item.id), source_failures: sourceFailures }, context);
      if (critic.output.recommended_confidence !== finalThesis.confidence) finalThesis = { ...finalThesis, confidence: critic.output.recommended_confidence };
      await move("ROUTE", "Resolving critic objections and applying the stopping rule");
      const unresolvedHigh = critic.output.objections.filter((item) => item.severity === "high" && !item.resolved);
      const stopping = evaluateStoppingRule({ requiredEvidencePresent: core.evidence.length > 0, unresolvedHighSeverity: unresolvedHigh.length, furtherCallExpectedValue: "low", budgetReached: false });
      if (!stopping.stop) throw new Error("Critic found unsupported material claims that could not be resolved within the run budget.");
      await addRunEvent(runId, "ROUTE", "info", "critic.resolved", "Critic review reduced confidence where durability or coverage was not established", { objections: critic.output.objections.length, initial_confidence: initial.thesis.confidence, final_confidence: finalThesis.confidence, stopping_reason: stopping.reason });
    }

    await move("FINALIZE", "Building the structured, evidence-linked report");
    const allEvidence = await listRunEvidence(runId);
    const report = buildReport({ runId, core: core.output, userMode: run.input.user_mode, initial: initial.thesis, final: finalThesis, evidence: allEvidence, sourceFailures, fixture: run.profileSnapshot.fixture_mode, critic: critic?.output ?? null, runtimeMs: Date.now() - started, cost: initial.usage.estimated_cost_usd, coreStatus: core.status, marketStatus: market?.status ?? "skipped" });
    assertReportEvidence(report, allEvidence); await saveReport(runId, report);
    await updateRunState(runId, "COMPLETED", { completed: true });
    await addRunEvent(runId, "COMPLETED", "info", "run.completed", "Investigation complete — the report is ready", { potential: report.verdict.breakout_potential, confidence: report.verdict.confidence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown investigation error";
    await updateRunState(runId, "FAILED", { error: message, completed: true });
    await addRunEvent(runId, "FAILED", "error", "run.failed", message);
    throw error;
  } finally { clearTimeout(timeout); }
}

function buildReport(input: { runId: string; core: RobloxDataOutput; userMode: "developer" | "investor"; initial: Thesis; final: Thesis; evidence: Evidence[]; sourceFailures: string[]; fixture: boolean; critic: { objections: Array<{ id: string; severity: "low" | "medium" | "high"; summary: string; affected_claim_ids: string[]; evidence_ids: string[]; resolution_request: string; resolved: boolean }>; summary: string } | null; runtimeMs: number; cost: number; coreStatus: "completed" | "degraded" | "skipped" | "failed"; marketStatus: "completed" | "degraded" | "skipped" | "failed" }): Report {
  const byModule = (id: string) => input.evidence.filter((item) => item.module_id === id).map((item) => item.id);
  const changed = input.initial.breakout_potential !== input.final.breakout_potential || input.initial.confidence !== input.final.confidence;
  const evidenceIds = [...new Set([...input.final.supporting_claims, ...input.final.risk_claims].flatMap((claim) => claim.evidence_ids))];
  return ReportSchema.parse({
    run_id: input.runId, game: { name: input.core.name, place_id: input.core.place_id, universe_id: input.core.universe_id, creator: input.core.creator, observed_at: new Date().toISOString(), thumbnail_url: null }, user_mode: input.userMode,
    verdict: { breakout_potential: input.final.breakout_potential, confidence: input.final.confidence, recommendation: input.final.recommendation }, initial_verdict: { breakout_potential: input.initial.breakout_potential, confidence: input.initial.confidence },
    audit_cards: [
      { module_id: "roblox-data", label: "Roblox data", status: input.coreStatus, summary: `${input.core.playing?.toLocaleString() ?? "Unknown"} playing · ${input.core.like_ratio == null ? "Like ratio unavailable" : `${(input.core.like_ratio * 100).toFixed(1)}% likes`} · ${input.core.recommendation_count} recommendation seeds`, evidence_ids: byModule("roblox-data"), warnings: input.sourceFailures.filter((item) => /vote|badge|recommend/i.test(item)) },
      { module_id: "market-intelligence", label: "Market & social", status: input.marketStatus, summary: input.marketStatus === "skipped" ? "Disabled by the immutable run profile" : "Direct attention, creator diversity, themes, and comparable context were reviewed.", evidence_ids: byModule("market-intelligence"), warnings: input.sourceFailures.filter((item) => /search|youtube|market/i.test(item)) },
      { module_id: "critic", label: "Verification", status: input.critic ? "completed" : "skipped", summary: input.critic?.summary ?? "Critic disabled by the immutable run profile.", evidence_ids: input.critic?.objections.flatMap((item) => item.evidence_ids) ?? [], warnings: [] },
    ],
    supporting_claims: input.final.supporting_claims, risk_claims: input.final.risk_claims,
    critic: { changed_assessment: changed, summary: input.critic?.summary ?? "No critic was enabled for this run.", objections: input.critic?.objections ?? [] },
    next_action: input.final.recommendation,
    monitor: ["Concurrent-player persistence after the latest update window", "Creator diversity and repeated independent coverage", "Favorites and votes normalized by visits", "Comparable-game position in Roblox recommendations"],
    limitations: ["Current platform metrics are a snapshot, not a historical growth series.", ...input.sourceFailures, ...(input.fixture ? ["This report uses cached fixture evidence and must not be presented as a live audit."] : [])],
    source_failures: input.sourceFailures, runtime_ms: input.runtimeMs, approximate_cost_usd: input.cost, evidence_ids: evidenceIds, is_fixture: input.fixture,
  });
}
