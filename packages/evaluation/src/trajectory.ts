/**
 * Exports one run's full agent trajectory to readable Markdown, so a reviewer can follow what every
 * agent did without standing up the stack. Same data the in-app `?view=trajectory` tab renders.
 *
 *   pnpm trajectory <run-id> [more-run-ids...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "@cronoblox/db";

const argv = process.argv.slice(2);
const remoteFlag = argv.indexOf("--remote");
const remoteOrigin = remoteFlag >= 0 ? (argv[remoteFlag + 1] ?? "").replace(/\/$/, "") : null;
const ids = argv.filter((value, index) => index !== remoteFlag && index !== remoteFlag + 1 && !value.startsWith("--"));
if (ids.length === 0) { console.error("usage: pnpm trajectory [--remote <origin>] <run-id> [run-id...]"); process.exit(1); }

/** Read a run either straight from Postgres or through a deployed instance's public JSON API. */
async function load(id: string) {
  if (!remoteOrigin) {
    const [run] = await sql<any[]>`select id, game_name, state::text, error, input, profile_snapshot, created_at from runs where id = ${id}`;
    if (!run) return null;
    const events = await sql<any[]>`select sequence, event_type, level, state::text, message, data, created_at from run_events where run_id = ${id} order by sequence`;
    const [reportRow] = await sql<any[]>`select report from reports where run_id = ${id}`;
    const [counts] = await sql<any[]>`select count(*)::text as records, count(distinct source_url) filter (where source_url is not null)::text as sources from evidence where run_id = ${id}`;
    return { run, events, report: reportRow?.report ?? null, records: Number(counts?.records ?? 0), sources: Number(counts?.sources ?? 0) };
  }
  const detail = await fetch(`${remoteOrigin}/api/runs/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!detail?.run) return null;
  const evidence: any[] = await fetch(`${remoteOrigin}/api/runs/${id}/evidence`).then((r) => (r.ok ? r.json() : { evidence: [] })).then((b) => b.evidence ?? []).catch(() => []);
  return {
    run: { ...detail.run, state: detail.run.state, created_at: detail.run.created_at },
    events: detail.events ?? [],
    report: detail.report ?? null,
    records: evidence.length,
    sources: new Set(evidence.map((item) => item.source?.url).filter(Boolean)).size,
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, "../../../trajectories");
await mkdir(outputDir, { recursive: true });

const pad = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

for (const id of ids) {
  const loaded = await load(id);
  if (!loaded) { console.error(`run ${id} not found`); continue; }
  const { run, report, records, sources } = loaded;
  const events: any[] = loaded.events;

  const started = new Date(run.created_at).getTime();
  const turns = events.filter((e) => e.event_type.endsWith(".llm_result"));
  const tools = events.filter((e) => e.event_type.endsWith(".tool_call"));
  const agents = [...new Set(events.map((e) => { const p = e.event_type.split("."); return p[0] === "module" && p.length > 2 ? p[1] : p[0]; }).filter((h) => !["state", "run"].includes(h)))];

  const lines = [
    `# Agent trajectory — ${run.game_name ?? run.input.game_url}`,
    ``,
    `| | |`, `| --- | --- |`,
    `| Run id | \`${run.id}\`${remoteOrigin ? ` — [open live](${remoteOrigin}/runs/${run.id}?view=trajectory)` : ""} |`,
    `| Input | ${run.input.game_url} |`,
    `| Profile | ${run.profile_snapshot.label} (${run.profile_snapshot.id}), effort ${run.profile_snapshot.effort}, model \`${run.profile_snapshot.model}\` |`,
    `| Final state | **${run.state}**${run.error ? ` — ${run.error}` : ""} |`,
    `| Agents involved | ${agents.join(", ")} |`,
    `| Model turns | ${turns.length} |`,
    `| Tool calls | ${tools.length} (budget ${run.profile_snapshot.limits.max_external_calls}) |`,
    `| Evidence records | ${records} across ${sources} distinct sources |`,
    report ? `| Rating | ${report.initial_verdict?.breakout_potential} → **${report.verdict?.breakout_potential}** (verification: ${report.critic?.verification_status ?? "n/a"}) |` : `| Rating | no report produced |`,
    report ? `| Runtime / cost | ${(report.runtime_ms / 1000).toFixed(1)}s / $${report.approximate_cost_usd.toFixed(6)} |` : ``,
    ``,
    `Private model reasoning is never persisted or shown. Timestamps are offsets from run creation.`,
    ``,
    `## Timeline`,
    ``,
  ];

  for (const event of events) {
    const [rawHead = "", ...rawRest] = event.event_type.split(".");
    // `module.roblox-data.completed` names the module in segment two, not segment one.
    const [head, rest] = rawHead === "module" && rawRest.length > 1 ? [rawRest[0]!, rawRest.slice(1)] : [rawHead, rawRest];
    const isAgent = !["state", "run"].includes(head) && rest.length > 0;
    const actor = isAgent ? head : "engine";
    const action = isAgent ? rest.join(".") : event.state;
    const mark = event.level === "error" ? " ❌" : event.level === "warning" ? " ⚠️" : "";
    lines.push(`**+${pad(new Date(event.created_at).getTime() - started)}** · \`${actor}\` · *${action}*${mark}`);
    lines.push(``, event.message, ``);
    if (event.data?.args && Object.keys(event.data.args).length > 0) lines.push("```json", JSON.stringify(event.data.args, null, 2), "```", "");
    const bits = [];
    if (typeof event.data?.duration_ms === "number") bits.push(`${(event.data.duration_ms / 1000).toFixed(1)}s`);
    if (typeof event.data?.prompt_tokens === "number") bits.push(`${event.data.prompt_tokens} in / ${event.data.completion_tokens} out tokens`);
    if (typeof event.data?.reason === "string" && event.data.reason) bits.push(`reason: ${event.data.reason}`);
    if (bits.length) lines.push(`> ${bits.join(" · ")}`, ``);
  }

  if (report) {
    lines.push(`## Final report`, ``, `**${report.verdict?.breakout_potential}** — ${report.verdict?.verdict_line}`, ``);
    for (const [title, claims] of [["Supporting claims", report.supporting_claims], ["Risk claims", report.risk_claims]] as const) {
      lines.push(`### ${title}`, ``);
      for (const claim of claims ?? []) lines.push(`- ${claim.text} — *${claim.evidence_ids.length} evidence record(s): ${claim.evidence_ids.join(", ")}*`);
      lines.push(``);
    }
    if (report.critic?.objections?.length) {
      lines.push(`### Critic objections`, ``);
      for (const objection of report.critic.objections) lines.push(`- **[${objection.severity}]** ${objection.summary}`);
      lines.push(``);
    }
  }

  const slug = (run.game_name ?? "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
  const path = resolve(outputDir, `${slug}-${run.profile_snapshot.id}.md`);
  await writeFile(path, lines.filter((l) => l !== undefined).join("\n"));
  console.log(`wrote ${path}  (${events.length} events)`);
}
if (!remoteOrigin) await sql.end();
