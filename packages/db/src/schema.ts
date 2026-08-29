import { index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnalysisInput, Evidence, ProfileSnapshot, Report } from "@cronoblox/contracts";

export const runState = pgEnum("run_state", ["QUEUED", "COLLECT_CORE", "PLAN", "EXECUTE", "RECORD", "SYNTHESIZE", "CRITIQUE", "ROUTE", "FINALIZE", "COMPLETED", "FAILED", "CANCELLED"]);
export const moduleStatus = pgEnum("module_status", ["completed", "degraded", "skipped", "failed"]);
export const evidenceKind = pgEnum("evidence_kind", ["fact", "inference", "recommendation"]);
export const evidenceRelationship = pgEnum("evidence_relationship", ["supports", "contradicts", "contextualizes", "unresolved"]);

export const analysisProfiles = pgTable("analysis_profiles", {
  id: text("id").notNull(), version: integer("version").notNull(), snapshot: jsonb("snapshot").$type<ProfileSnapshot>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("analysis_profiles_id_version_uq").on(table.id, table.version)]);

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(), input: jsonb("input").$type<AnalysisInput>().notNull(),
  state: runState("state").notNull().default("QUEUED"), profileSnapshot: jsonb("profile_snapshot").$type<ProfileSnapshot>().notNull(),
  placeId: text("place_id"), universeId: text("universe_id"), gameName: text("game_name"),
  error: text("error"), cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("runs_universe_created_idx").on(table.universeId, table.createdAt)]);

export const runModules = pgTable("run_modules", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  moduleId: text("module_id").notNull(), moduleVersion: text("module_version").notNull(), status: moduleStatus("status").notNull(),
  output: jsonb("output").notNull(), warnings: jsonb("warnings").$type<string[]>().notNull().default([]), metrics: jsonb("metrics").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("run_modules_run_module_uq").on(table.runId, table.moduleId)]);

export const runSteps = pgTable("run_steps", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), state: runState("state").notNull(), idempotencyKey: text("idempotency_key").notNull(),
  input: jsonb("input"), output: jsonb("output"), startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("run_steps_idempotency_uq").on(table.runId, table.idempotencyKey), index("run_steps_sequence_idx").on(table.runId, table.sequence)]);

export const runEvents = pgTable("run_events", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(), state: runState("state").notNull(), level: text("level").notNull(), eventType: text("event_type").notNull(),
  message: text("message").notNull(), data: jsonb("data").notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("run_events_sequence_uq").on(table.runId, table.sequence), index("run_events_run_idx").on(table.runId, table.sequence)]);

export const rawArtifacts = pgTable("raw_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), artifactKey: text("artifact_key").notNull(), payload: jsonb("payload").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("raw_artifacts_key_uq").on(table.runId, table.provider, table.artifactKey)]);

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  moduleId: text("module_id").notNull(), kind: evidenceKind("kind").notNull(), relationship: evidenceRelationship("relationship").notNull(),
  claim: text("claim").notNull(), supportStrength: text("support_strength").notNull(), sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"), observedAt: timestamp("observed_at", { withTimezone: true }).notNull(), record: jsonb("record").$type<Evidence>().notNull(),
  supersedesId: text("supersedes_id"), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("evidence_run_module_idx").on(table.runId, table.moduleId), index("evidence_kind_relationship_idx").on(table.runId, table.kind, table.relationship)]);

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }).unique(),
  report: jsonb("report").$type<Report>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerCache = pgTable("provider_cache", {
  id: uuid("id").primaryKey().defaultRandom(), provider: text("provider").notNull(), cacheKey: text("cache_key").notNull(),
  payload: jsonb("payload").notNull(), statusCode: integer("status_code").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("provider_cache_key_uq").on(table.provider, table.cacheKey), index("provider_cache_lookup_idx").on(table.provider, table.cacheKey, table.expiresAt)]);

export const evaluationScores = pgTable("evaluation_scores", {
  id: uuid("id").primaryKey().defaultRandom(), runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  reviewer: text("reviewer"), rubric: jsonb("rubric").notNull(), total: numeric("total"), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
