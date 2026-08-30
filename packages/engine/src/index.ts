import { createRunBudget } from "@cronoblox/agent-core";
import { assertReportEvidence, ReportSchema, type Evidence, type Report, type RunState, type Thesis } from "@cronoblox/contracts";
import { addRunEvent, appendEvidence, getRunRow, listRunEvidence, listRunModules, saveModuleResult, saveRawArtifact, saveReport, updateRunState, type RunModuleRow } from "@cronoblox/db";
import { ModuleRegistry, ModuleRunner, type ModuleContext, type ModuleResult } from "@cronoblox/module-sdk";
import { robloxDataModule, type RobloxDataOutput } from "@cronoblox/module-roblox-data";
import { dataAgentModule } from "@cronoblox/module-data-agent";
import { marketIntelligenceModule } from "@cronoblox/module-market-intelligence";
import { orchestratorModule } from "@cronoblox/module-orchestrator";
import { criticModule } from "@cronoblox/module-critic";
import { evaluateStoppingRule } from "./stopping";
export { evaluateStoppingRule } from "./stopping";

export const registry = new ModuleRegistry().register(robloxDataModule).register(dataAgentModule).register(marketIntelligenceModule).register(orchestratorModule).register(criticModule);
export const P0_EXECUTION_ORDER = ["roblox-data", "orchestrator", "critic", "finalize"] as const;

export interface EngineHooks { onState?(state: RunState): void | Promise<void> }

const AUDIT_CARD_DEFS = [
  { id: "roblox-data", label: "Roblox data" },
  { id: "data-agent", label: "Data agent (deep Roblox research)" },
  { id: "market-intelligence", label: "Market & social" },
  { id: "critic", label: "Verification" },
] as const;

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

  const sourceFailures: string[] = [];
  const budget = createRunBudget({ maxExternalCalls: run.profileSnapshot.limits.max_external_calls, maxCostUsd: run.profileSnapshot.limits.max_cost_usd });

  const context: ModuleContext = {
    runId, profile: run.profileSnapshot, signal: controller.signal, now: () => new Date(), getEvidence: () => listRunEvidence(runId),
    saveRawArtifact: (provider, key, payload) => saveRawArtifact(runId, provider, key, payload),
    emit: (level, type, message, data = {}) => addRunEvent(runId, activeState, level, type, message, data),
    budget,
    runModule: (id, input) => runner.run(id, input, context),
  };
  const runner = new ModuleRunner(registry, async (manifest, result: ModuleResult<unknown>) => {
    await saveModuleResult(runId, manifest.id, manifest.version, result);
    await appendEvidence(runId, result.evidence);
    sourceFailures.push(...result.warnings);
  });

  try {
    await move("COLLECT_CORE", "Resolving game identity and collecting current Roblox evidence");
    // Enforced by code: no planner or optional module executes before this mandatory call.
    const core = await runner.run<{ game_url: string }, RobloxDataOutput>("roblox-data", { game_url: run.input.game_url }, context);
    await updateRunState(runId, "COLLECT_CORE", { gameName: core.output.name, placeId: core.output.place_id, universeId: core.output.universe_id });
    await addRunEvent(runId, "COLLECT_CORE", core.status === "degraded" ? "warning" : "info", "module.roblox-data.completed", `${core.output.name} resolved and validated`, { status: core.status, evidence_count: core.evidence.length });

    if ((await getRunRow(runId))?.state === "CANCELLED") return;

    const gameContext = {
      name: core.output.name, description: core.output.description, genre: core.output.genre, universe_id: core.output.universe_id,
      playing: core.output.playing, visits: core.output.visits, favorites: core.output.favorites,
      like_ratio: core.output.like_ratio, favorites_per_1000_visits: core.output.favorites_per_1000_visits,
    };
    const baseline = run.profileSnapshot.id === "baseline";

    await move("PLAN", baseline ? "Preparing the single direct model assessment" : "Deciding how much research is worth delegating");
    await move("EXECUTE", "Orchestrator researching and delegating to sub-agents as needed");
    let orchestratorResult = await runner.run<Parameters<typeof orchestratorModule.execute>[0], Thesis>("orchestrator", { game: gameContext, user_mode: run.input.user_mode, baseline, critic_feedback: [] }, context);
    const initialThesis: Thesis = orchestratorResult.output;
    let finalThesis: Thesis = initialThesis;

    await move("RECORD", "Normalizing and validating evidence gathered so far");
    const dedupedFailures = () => [...new Set(sourceFailures)];
    let critic: Awaited<ReturnType<typeof criticModule.execute>> | null = null;

    if (run.profileSnapshot.enabled_modules.includes("critic")) {
      await move("SYNTHESIZE", "Initial thesis formed — handing off for verification");
      await move("CRITIQUE", "Challenging the thesis for unsupported claims and alternative explanations");
      let cycles = 0;
      const evidenceIds = async () => (await listRunEvidence(runId)).map((item) => item.id);
      critic = await runner.run("critic", { thesis: finalThesis, evidence_ids: await evidenceIds(), source_failures: dedupedFailures() }, context);
      if (critic.output.recommended_potential !== finalThesis.breakout_potential) finalThesis = { ...finalThesis, breakout_potential: critic.output.recommended_potential };
      await move("ROUTE", "Resolving critic objections and applying the stopping rule");
      let unresolvedHigh = critic.output.objections.filter((item) => item.severity === "high" && !item.resolved);
      const maxCycles = run.profileSnapshot.limits.max_critic_cycles;

      while (unresolvedHigh.length > 0 && cycles < maxCycles) {
        cycles += 1;
        await addRunEvent(runId, "ROUTE", "info", "critic.revise", `Revising the thesis to address ${unresolvedHigh.length} unresolved high-severity objection(s) (cycle ${cycles}/${maxCycles})`, { objections: unresolvedHigh.map((item) => item.summary) });
        orchestratorResult = await runner.run<Parameters<typeof orchestratorModule.execute>[0], Thesis>("orchestrator", { game: gameContext, user_mode: run.input.user_mode, baseline, critic_feedback: unresolvedHigh.map((item) => ({ summary: item.summary, resolution_request: item.resolution_request })) }, context);
        finalThesis = orchestratorResult.output;
        critic = await runner.run("critic", { thesis: finalThesis, evidence_ids: await evidenceIds(), source_failures: dedupedFailures() }, context);
        if (critic.output.recommended_potential !== finalThesis.breakout_potential) finalThesis = { ...finalThesis, breakout_potential: critic.output.recommended_potential };
        unresolvedHigh = critic.output.objections.filter((item) => item.severity === "high" && !item.resolved);
      }

      const stopping = evaluateStoppingRule({ requiredEvidencePresent: core.evidence.length > 0, unresolvedHighSeverity: unresolvedHigh.length, furtherCallExpectedValue: unresolvedHigh.length > 0 && cycles < maxCycles ? "medium" : "low", budgetReached: cycles >= maxCycles });
      if (!stopping.stop) throw new Error("Critic found unsupported material claims that could not be resolved within the run budget.");
      await addRunEvent(runId, "ROUTE", "info", "critic.resolved", finalThesis.breakout_potential === initialThesis.breakout_potential ? "Critic review held the rating — the evidence survived verification" : `Critic review lowered breakout potential from ${initialThesis.breakout_potential} to ${finalThesis.breakout_potential}`, { objections: critic.output.objections.length, cycles, initial_potential: initialThesis.breakout_potential, final_potential: finalThesis.breakout_potential, stopping_reason: stopping.reason });
    } else {
      await move("SYNTHESIZE", "Thesis formed — critic disabled by the immutable run profile");
    }

    await move("FINALIZE", "Building the structured, evidence-linked report");
    const allEvidence = await listRunEvidence(runId);
    const moduleRows = await listRunModules(runId);
    const report = buildReport({ runId, core: core.output, userMode: run.input.user_mode, initial: initialThesis, final: finalThesis, evidence: allEvidence, moduleRows, sourceFailures: dedupedFailures(), fixture: run.profileSnapshot.fixture_mode, critic: critic?.output ?? null, runtimeMs: Date.now() - started, cost: budget.snapshot().costUsd });
    assertReportEvidence(report, allEvidence); await saveReport(runId, report);
    await updateRunState(runId, "COMPLETED", { completed: true });
    await addRunEvent(runId, "COMPLETED", "info", "run.completed", "Investigation complete — the report is ready", { potential: report.verdict.breakout_potential });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown investigation error";
    await updateRunState(runId, "FAILED", { error: message, completed: true });
    await addRunEvent(runId, "FAILED", "error", "run.failed", message);
    throw error;
  } finally { clearTimeout(timeout); }
}

function buildReport(input: { runId: string; core: RobloxDataOutput; userMode: "developer" | "investor"; initial: Thesis; final: Thesis; evidence: Evidence[]; moduleRows: RunModuleRow[]; sourceFailures: string[]; fixture: boolean; critic: { objections: Array<{ id: string; severity: "low" | "medium" | "high"; summary: string; affected_claim_ids: string[]; evidence_ids: string[]; resolution_request: string; resolved: boolean }>; summary: string } | null; runtimeMs: number; cost: number }): Report {
  const byModule = (id: string) => input.evidence.filter((item) => item.module_id === id).map((item) => item.id);
  const changed = input.initial.breakout_potential !== input.final.breakout_potential;
  const evidenceIds = [...new Set([...input.final.supporting_claims, ...input.final.risk_claims].flatMap((claim) => claim.evidence_ids))];

  const auditCards = AUDIT_CARD_DEFS.map((def) => {
    const row = input.moduleRows.find((item) => item.moduleId === def.id);
    if (!row) return { module_id: def.id, label: def.label, status: "skipped" as const, summary: def.id === "critic" ? "Critic disabled by the immutable run profile." : "Not delegated during this run.", evidence_ids: byModule(def.id), warnings: [] };
    return { module_id: def.id, label: def.label, status: row.status, summary: summarizeModule(def.id, row), evidence_ids: byModule(def.id), warnings: row.warnings };
  });

  return ReportSchema.parse({
    run_id: input.runId,
    game: {
      name: input.core.name, place_id: input.core.place_id, universe_id: input.core.universe_id,
      creator: input.core.creator, creator_id: input.core.creator_id, creator_type: input.core.creator_type,
      url: input.core.url, creator_url: input.core.creator_url, observed_at: new Date().toISOString(),
      icon_url: input.core.icon_url, thumbnail_url: input.core.thumbnails[0] ?? null, thumbnails: input.core.thumbnails,
    },
    user_mode: input.userMode,
    verdict: { breakout_potential: input.final.breakout_potential, verdict_line: input.final.verdict_line, recommendation: input.final.recommendation }, initial_verdict: { breakout_potential: input.initial.breakout_potential },
    audit_cards: auditCards,
    supporting_claims: input.final.supporting_claims, risk_claims: input.final.risk_claims,
    critic: { changed_assessment: changed, summary: input.critic?.summary ?? "No critic was enabled for this run.", objections: input.critic?.objections ?? [] },
    next_action: input.final.recommendation,
    monitor: ["Concurrent-player persistence after the latest update window", "Creator diversity and repeated independent coverage", "Favorites and votes normalized by visits", "Comparable-game position in Roblox recommendations"],
    limitations: ["Current platform metrics are a snapshot, not a historical growth series.", ...(input.fixture ? [] : ["This run has no general web-search tool — social/creator coverage is YouTube-only."]), ...input.sourceFailures, ...(input.fixture ? ["This report uses cached fixture evidence and must not be presented as a live audit."] : [])],
    source_failures: input.sourceFailures, runtime_ms: input.runtimeMs, approximate_cost_usd: input.cost, evidence_ids: evidenceIds, is_fixture: input.fixture,
  });
}

function summarizeModule(id: string, row: RunModuleRow): string {
  const output = row.output as Record<string, unknown>;
  if (id === "roblox-data") { const playing = output.playing as number | null; const likeRatio = output.like_ratio as number | null; const recs = output.recommendation_count as number; return `${playing?.toLocaleString() ?? "Unknown"} playing · ${likeRatio == null ? "Like ratio unavailable" : `${(likeRatio * 100).toFixed(1)}% likes`} · ${recs} recommendation seeds`; }
  if (id === "data-agent") return typeof output.summary === "string" ? output.summary : "Deep Roblox research delegation.";
  if (id === "market-intelligence") return typeof output.summary === "string" ? output.summary : "Web/social research delegation.";
  if (id === "critic") return typeof output.summary === "string" ? output.summary : "Verification pass.";
  return "Completed.";
}
