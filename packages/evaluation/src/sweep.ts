/**
 * Launches the frozen evaluation sweep: every case is submitted twice, once on the baseline
 * profile and once on the full agent, with identical URL, effort and user mode. It only enqueues —
 * the worker owns execution — so this is safe to re-run and safe to interrupt.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(await readFile(resolve(here, "../cases.json"), "utf8"));
const base = process.env.CRONOBLOX_PUBLIC_URL ?? "http://localhost:3017";
const profiles = [spec.profiles.baseline, spec.profiles.solution] as const;

const manifest: { origin: string; generated_at: string; settings: unknown; runs: { case_id: string; profile: string; run_id: string }[] } = { origin: base, generated_at: new Date().toISOString(), settings: spec.settings, runs: [] };

for (const item of spec.cases) {
  for (const profile of profiles) {
    const body = {
      game_url: `https://www.roblox.com/games/${item.place_id}/g`,
      user_mode: spec.settings.user_mode,
      profile_id: profile,
      effort: spec.settings.effort,
      optional_modules: profile === spec.profiles.solution ? ["market-intelligence", "critic"] : [],
    };
    const response = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { console.error(`${item.id} ${profile}: FAILED TO ENQUEUE — ${payload.error ?? response.status}`); continue; }
    manifest.runs.push({ case_id: item.id, profile, run_id: payload.run_id });
    console.log(`${item.id} ${profile.padEnd(8)} ${payload.run_id} ${item.label}`);
  }
}
// The public run list is capped, so the manifest is how `evaluate --remote` finds these exact runs.
const outputDir = resolve(here, "../../../evaluation-output");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "sweep.json"), JSON.stringify(manifest, null, 2));

console.log(`\nEnqueued ${manifest.runs.length} runs and wrote evaluation-output/sweep.json.`);
console.log(`Watch them at ${base}, then run \`pnpm evaluate\`${base.includes("localhost") ? "" : ` --remote ${base}`}.`);
