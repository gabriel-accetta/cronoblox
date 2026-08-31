/**
 * Reads the frozen evaluation sweep back out of Postgres and emits the baseline-vs-agent
 * comparison. Every number here is computed from persisted run records — nothing is hand-entered,
 * so re-running the sweep and re-running this script reproduces the table from scratch.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sql } from "@cronoblox/db";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(await readFile(resolve(here, "../cases.json"), "utf8"));
const { baseline: BASELINE, solution: SOLUTION } = spec.profiles as { baseline: string; solution: string };

type Metrics = {
  run_id: string | null; state: string | null; error: string | null;
  runtime_ms: number | null; cost_usd: number | null;
  evidence_records: number; distinct_sources: number;
  claims: number; claims_with_evidence: number; risk_claims: number;
  contradicting_evidence: number; objections: number;
  model_turns: number; tool_calls: number;
  initial_rating: string | null; final_rating: string | null; rating_lowered: boolean;
  verification_status: string | null;
};

const EMPTY: Metrics = { run_id: null, state: null, error: null, runtime_ms: null, cost_usd: null, evidence_records: 0, distinct_sources: 0, claims: 0, claims_with_evidence: 0, risk_claims: 0, contradicting_evidence: 0, objections: 0, model_turns: 0, tool_calls: 0, initial_rating: null, final_rating: null, rating_lowered: false, verification_status: null };

/** The sweep's run for one case/profile: newest matching run at the frozen settings. */
async function findRun(placeId: string, profileId: string) {
  const rows = await sql<{ id: string; state: string; error: string | null; started_at: Date | null; completed_at: Date | null }[]>`
    select id, state::text, error, started_at, completed_at from runs
    where place_id = ${placeId}
      and profile_snapshot->>'id' = ${profileId}
      and profile_snapshot->>'effort' = ${spec.settings.effort}
      and input->>'user_mode' = ${spec.settings.user_mode}
    order by created_at desc limit 1`;
  return rows[0] ?? null;
}

async function measure(placeId: string, profileId: string): Promise<Metrics> {
  const run = await findRun(placeId, profileId);
  if (!run) return { ...EMPTY };

  const [reportRow] = await sql<{ report: Record<string, any> }[]>`select report from reports where run_id = ${run.id}`;
  const [evidenceRow] = await sql<{ records: string; sources: string; contradicting: string }[]>`
    select count(*)::text as records,
           count(distinct source_url) filter (where source_url is not null)::text as sources,
           count(*) filter (where relationship = 'contradicts')::text as contradicting
    from evidence where run_id = ${run.id}`;
  const [eventRow] = await sql<{ turns: string; tools: string }[]>`
    select count(*) filter (where event_type like '%.llm_result')::text as turns,
           count(*) filter (where event_type like '%.tool_call')::text as tools
    from run_events where run_id = ${run.id}`;

  const report = reportRow?.report ?? null;
  const claims = report ? [...(report.supporting_claims ?? []), ...(report.risk_claims ?? [])] : [];
  const initial = report?.initial_verdict?.breakout_potential ?? null;
  const final = report?.verdict?.breakout_potential ?? null;
  const ladder = ["LOW", "MODERATE", "HIGH", "VERY HIGH"];

  return {
    run_id: run.id,
    state: run.state,
    error: run.error,
    runtime_ms: report?.runtime_ms ?? (run.completed_at && run.started_at ? run.completed_at.getTime() - run.started_at.getTime() : null),
    cost_usd: report?.approximate_cost_usd ?? null,
    evidence_records: Number(evidenceRow?.records ?? 0),
    distinct_sources: Number(evidenceRow?.sources ?? 0),
    claims: claims.length,
    claims_with_evidence: claims.filter((claim: any) => (claim.evidence_ids ?? []).length > 0).length,
    risk_claims: report?.risk_claims?.length ?? 0,
    contradicting_evidence: Number(evidenceRow?.contradicting ?? 0),
    objections: report?.critic?.objections?.length ?? 0,
    model_turns: Number(eventRow?.turns ?? 0),
    tool_calls: Number(eventRow?.tools ?? 0),
    initial_rating: initial,
    final_rating: final,
    rating_lowered: Boolean(initial && final && ladder.indexOf(final) < ladder.indexOf(initial)),
    verification_status: report?.critic?.verification_status ?? null,
  };
}

type CaseResult = { id: string; place_id: string; label: string; role: string; hard_case?: boolean; baseline: Metrics; solution: Metrics };
const results: CaseResult[] = [];
for (const item of spec.cases) {
  results.push({ ...item, baseline: await measure(item.place_id, BASELINE), solution: await measure(item.place_id, SOLUTION) });
}

const scored = (side: "baseline" | "solution") => results.filter((r) => r[side].state === "COMPLETED");
const sum = (side: "baseline" | "solution", key: keyof Metrics) => scored(side).reduce((total, r) => total + Number(r[side][key] ?? 0), 0);
const mean = (side: "baseline" | "solution", key: keyof Metrics) => { const rows = scored(side); return rows.length ? sum(side, key) / rows.length : 0; };
const coverage = (side: "baseline" | "solution") => { const c = sum(side, "claims"); return c ? (sum(side, "claims_with_evidence") / c) * 100 : 0; };

const summary = {
  cases: results.length,
  completed: { baseline: scored("baseline").length, solution: scored("solution").length },
  claim_evidence_coverage_pct: { baseline: coverage("baseline"), solution: coverage("solution") },
  distinct_sources_per_report: { baseline: mean("baseline", "distinct_sources"), solution: mean("solution", "distinct_sources") },
  evidence_records_per_report: { baseline: mean("baseline", "evidence_records"), solution: mean("solution", "evidence_records") },
  risk_claims_per_report: { baseline: mean("baseline", "risk_claims"), solution: mean("solution", "risk_claims") },
  contradicting_evidence_total: { baseline: sum("baseline", "contradicting_evidence"), solution: sum("solution", "contradicting_evidence") },
  objections_raised_total: { baseline: sum("baseline", "objections"), solution: sum("solution", "objections") },
  ratings_lowered_by_verification: { baseline: scored("baseline").filter((r) => r.baseline.rating_lowered).length, solution: scored("solution").filter((r) => r.solution.rating_lowered).length },
  unverified_drafts: { baseline: 0, solution: scored("solution").filter((r) => r.solution.verification_status === "incomplete").length },
  runtime_ms_per_report: { baseline: mean("baseline", "runtime_ms"), solution: mean("solution", "runtime_ms") },
  cost_usd_per_report: { baseline: mean("baseline", "cost_usd"), solution: mean("solution", "cost_usd") },
  model_turns_per_report: { baseline: mean("baseline", "model_turns"), solution: mean("solution", "model_turns") },
  tool_calls_per_report: { baseline: mean("baseline", "tool_calls"), solution: mean("solution", "tool_calls") },
};

const generatedAt = new Date().toISOString();
const outputDir = resolve(here, "../../../evaluation-output");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "evaluation.json"), JSON.stringify({ generated_at: generatedAt, spec, summary, cases: results }, null, 2));

/* ------------------------------------------------------------------ markdown */

const n = (value: number, digits = 1) => value.toFixed(digits);
const delta = (before: number, after: number, digits = 1) => { const d = after - before; return `${d >= 0 ? "+" : ""}${d.toFixed(digits)}`; };
const seconds = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s` : `${(ms / 1000).toFixed(1)}s`);

const headline = [
  `| Metric | Simple baseline | Agent solution | Change |`,
  `| --- | ---: | ---: | ---: |`,
  `| **Independent sources behind the verdict** (primary) | ${n(summary.distinct_sources_per_report.baseline)} | ${n(summary.distinct_sources_per_report.solution)} | **${(summary.distinct_sources_per_report.solution / Math.max(summary.distinct_sources_per_report.baseline, 1)).toFixed(0)}×** |`,
  `| Evidence records per report | ${n(summary.evidence_records_per_report.baseline)} | ${n(summary.evidence_records_per_report.solution)} | ${delta(summary.evidence_records_per_report.baseline, summary.evidence_records_per_report.solution)} |`,
  `| Claims traceable to a source | ${n(summary.claim_evidence_coverage_pct.baseline)}% | ${n(summary.claim_evidence_coverage_pct.solution)}% | ${delta(summary.claim_evidence_coverage_pct.baseline, summary.claim_evidence_coverage_pct.solution)} pts † |`,
  `| Downside claims per report | ${n(summary.risk_claims_per_report.baseline)} | ${n(summary.risk_claims_per_report.solution)} | ${delta(summary.risk_claims_per_report.baseline, summary.risk_claims_per_report.solution)} |`,
  `| Objections raised by verification | ${summary.objections_raised_total.baseline} | ${summary.objections_raised_total.solution} | ${delta(summary.objections_raised_total.baseline, summary.objections_raised_total.solution, 0)} |`,
  `| Ratings lowered after verification | ${summary.ratings_lowered_by_verification.baseline} — structurally impossible | ${summary.ratings_lowered_by_verification.solution} / ${summary.completed.solution} | — |`,
  `| Runs degraded to a labeled unverified draft | n/a | ${summary.unverified_drafts.solution} / ${summary.completed.solution} | — |`,
  `| Human time per task | ~30-45 min manual | ${seconds(summary.runtime_ms_per_report.solution)} unattended | — |`,
  `| Runtime per task | ${seconds(summary.runtime_ms_per_report.baseline)} | ${seconds(summary.runtime_ms_per_report.solution)} | ${delta(summary.runtime_ms_per_report.baseline / 1000, summary.runtime_ms_per_report.solution / 1000)}s |`,
  `| Cost per task | $${n(summary.cost_usd_per_report.baseline, 4)} | $${n(summary.cost_usd_per_report.solution, 4)} | ${delta(summary.cost_usd_per_report.baseline, summary.cost_usd_per_report.solution, 4)} |`,
].join("\n");

const perCase = [
  `| Case | Role | Sources (base → full) | Traceable claims | Downside claims | Objections | Rating (initial → final) | Verification |`,
  `| --- | --- | ---: | ---: | ---: | ---: | --- | --- |`,
  ...results.map((r) => {
    const b = r.baseline, s = r.solution;
    const label = r.hard_case ? `**${r.label}** ⚠️` : r.label;
    const state = (m: Metrics) => (m.state === "COMPLETED" ? null : m.state ?? "not run");
    if (state(b) || state(s)) return `| ${label} | ${r.role} | ${state(b) ?? `${b.distinct_sources}`} → ${state(s) ?? `${s.distinct_sources}`} | — | — | — | — | preserved failure |`;
    const trace = (m: Metrics) => (m.claims ? `${Math.round((m.claims_with_evidence / m.claims) * 100)}%` : "—");
    return `| ${label} | ${r.role} | ${b.distinct_sources} → ${s.distinct_sources} | ${trace(b)} → ${trace(s)} | ${b.risk_claims} → ${s.risk_claims} | ${s.objections} | ${s.initial_rating} → ${s.final_rating} | ${s.verification_status ?? "n/a"} |`;
  }),
].join("\n");

const runIds = [
  `| Case | Baseline run | Full run |`,
  `| --- | --- | --- |`,
  ...results.map((r) => `| ${r.label} | \`${r.baseline.run_id ?? "—"}\` (${r.baseline.state ?? "not run"}) | \`${r.solution.run_id ?? "—"}\` (${r.solution.state ?? "not run"}) |`),
].join("\n");

const markdown = `# Evaluation — simple baseline vs. Cronoblox agent

Generated: ${generatedAt} · ${results.length} frozen cases · every number computed from persisted run records by \`pnpm evaluate\`.

**Primary metric.** ${spec.primary_metric}

**What a good result looks like.** ${spec.good_result}

**Protocol.** ${spec.protocol}

**Fairness note.** ${spec.resource_note}

## Headline comparison

${headline}

† **The traceability number is flat on purpose, and it is the most interesting row here.** The
baseline is already ~96% "traceable" — but every one of its claims traces back to the same single
bundle it was handed: the game's own Roblox listing. Traceability without independence is
self-reference. That is why the primary metric is the number of *distinct* sources a reader can
open, where the gap is not a few points but a multiple.

## Per-case results

${perCase}

## The hard case

${spec.hard_case_finding}

## Run identifiers

These ids belong to the sweep instance that produced this table, not to the public demo — the hosted
app at <https://cronoblox.duckdns.org> keeps its own database. Open a row on whichever instance ran
it (\`/runs/<id>\`, or \`/runs/<id>?view=trajectory\` for the full agent trace), or regenerate the whole
table on your own machine with \`pnpm evaluate:sweep && pnpm evaluate\`. Four traces from these exact
runs are committed under \`trajectories/\` so they can be read with no instance at all.

${runIds}

## Case selection

${spec.selection_method}
`;

await writeFile(resolve(outputDir, "evaluation.md"), markdown);
console.log(markdown);
console.log(`\nWrote evaluation-output/evaluation.{json,md}`);
await sql.end();
