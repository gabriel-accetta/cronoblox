import { and, asc, desc, eq, gt, sql as dsql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { EvidenceSchema, ReportSchema, type AnalysisInput, type Evidence, type ProfileSnapshot, type Report, type RunEvent, type RunState, type RunSummary } from "@cronoblox/contracts";
import { db } from "./index";
import { evidence, rawArtifacts, reports, runEvents, runModules, runs } from "./schema";

export async function createRun(input: AnalysisInput, profile: ProfileSnapshot) {
  const [created] = await db.insert(runs).values({ input, profileSnapshot: profile }).returning();
  if (!created) throw new Error("Failed to create run");
  await addRunEvent(created.id, "QUEUED", "info", "run.queued", "Investigation queued", { fixture: profile.fixture_mode });
  return created;
}

export async function updateRunState(runId: string, state: RunState, patch: { gameName?: string; placeId?: string; universeId?: string; error?: string; started?: boolean; completed?: boolean } = {}) {
  await db.update(runs).set({
    state, gameName: patch.gameName, placeId: patch.placeId, universeId: patch.universeId,
    // Explicitly cleared on the way back to a healthy state, so a retry cannot leave a stale failure behind.
    error: patch.error ?? (state === "COMPLETED" || state === "COLLECT_CORE" ? null : undefined),
    startedAt: patch.started ? new Date() : undefined, completedAt: patch.completed ? new Date() : undefined, updatedAt: new Date(),
  }).where(eq(runs.id, runId));
}

export async function addRunEvent(runId: string, state: RunState, level: "info" | "warning" | "error", eventType: string, message: string, data: Record<string, unknown> = {}) {
  const [row] = await db.select({ max: dsql<number>`coalesce(max(${runEvents.sequence}), -1)` }).from(runEvents).where(eq(runEvents.runId, runId));
  await db.insert(runEvents).values({ runId, sequence: Number(row?.max ?? -1) + 1, state, level, eventType, message, data });
}

export async function saveModuleResult(runId: string, moduleId: string, moduleVersion: string, result: { status: "completed" | "degraded" | "skipped" | "failed"; output: unknown; warnings: string[]; metrics: unknown }) {
  await db.insert(runModules).values({ runId, moduleId, moduleVersion, status: result.status, output: result.output as object, warnings: result.warnings, metrics: result.metrics as object }).onConflictDoUpdate({
    target: [runModules.runId, runModules.moduleId], set: { status: result.status, output: result.output as object, warnings: result.warnings, metrics: result.metrics as object },
  });
}

export async function appendEvidence(runId: string, items: readonly Evidence[]) {
  if (!items.length) return;
  await db.insert(evidence).values(items.map((raw) => {
    const item = EvidenceSchema.parse(raw);
    return { id: item.id, runId, moduleId: item.module_id, kind: item.kind, relationship: item.relationship, claim: item.claim, supportStrength: item.support_strength, sourceType: item.source.type, sourceUrl: item.source.url, observedAt: new Date(item.source.retrieved_at), record: item, supersedesId: item.supersedes_id };
  })).onConflictDoNothing({ target: evidence.id });
}

export async function saveRawArtifact(runId: string, provider: string, artifactKey: string, payload: unknown, retrievedAt = new Date()) {
  await db.insert(rawArtifacts).values({ runId, provider, artifactKey, payload: payload as object, retrievedAt }).onConflictDoUpdate({
    target: [rawArtifacts.runId, rawArtifacts.provider, rawArtifacts.artifactKey], set: { payload: payload as object, retrievedAt },
  });
}

export async function saveReport(runId: string, value: Report) {
  const report = ReportSchema.parse(value);
  await db.insert(reports).values({ runId, report }).onConflictDoUpdate({ target: reports.runId, set: { report } });
}

export async function getRunRow(runId: string) {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row ?? null;
}

export async function listRunEvidence(runId: string): Promise<Evidence[]> {
  const rows = await db.select({ record: evidence.record }).from(evidence).where(eq(evidence.runId, runId)).orderBy(asc(evidence.createdAt));
  return rows.map((row) => EvidenceSchema.parse(row.record));
}

export interface RunModuleRow { moduleId: string; status: "completed" | "degraded" | "skipped" | "failed"; output: unknown; warnings: string[] }

/** The latest persisted result per module id for a run. A module the orchestrator never delegated to simply has no row. */
export async function listRunModules(runId: string): Promise<RunModuleRow[]> {
  const rows = await db.select({ moduleId: runModules.moduleId, status: runModules.status, output: runModules.output, warnings: runModules.warnings }).from(runModules).where(eq(runModules.runId, runId));
  return rows;
}

export async function getReport(runId: string): Promise<Report | null> {
  const [row] = await db.select({ report: reports.report }).from(reports).where(eq(reports.runId, runId)).limit(1);
  return row ? ReportSchema.parse(row.report) : null;
}

function toSummary(row: typeof runs.$inferSelect): RunSummary {
  return { id: row.id, input: row.input, state: row.state, game_name: row.gameName, universe_id: row.universeId, profile_snapshot: row.profileSnapshot, error: row.error, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() };
}

export async function getRunSummary(runId: string) {
  const row = await getRunRow(runId);
  return row ? toSummary(row) : null;
}

export async function listRecentRuns(limit = 10) {
  const rows = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit);
  return rows.map(toSummary);
}

export async function listEvents(runId: string, afterSequence = -1): Promise<RunEvent[]> {
  const rows = await db.select().from(runEvents).where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence))).orderBy(asc(runEvents.sequence));
  return rows.map((row) => ({ id: row.id, run_id: row.runId, sequence: row.sequence, state: row.state, level: row.level as "info" | "warning" | "error", event_type: row.eventType, message: row.message, data: row.data as Record<string, unknown>, created_at: row.createdAt.toISOString() }));
}

export async function cancelRun(runId: string) {
  await db.update(runs).set({ state: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(runs.id, runId));
  await addRunEvent(runId, "CANCELLED", "warning", "run.cancelled", "Investigation cancelled by user");
}

export async function resetFailedRun(runId: string) {
  await db.update(runs).set({ state: "QUEUED", error: null, completedAt: null, updatedAt: new Date() }).where(eq(runs.id, runId));
  await addRunEvent(runId, "QUEUED", "info", "run.retried", "Investigation queued for retry");
}
