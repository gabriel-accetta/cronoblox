/**
 * Launches the frozen evaluation sweep: every case is submitted twice, once on the baseline
 * profile and once on the full agent, with identical URL, effort and user mode. It only enqueues —
 * the worker owns execution — so this is safe to re-run and safe to interrupt.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(await readFile(resolve(here, "../cases.json"), "utf8"));
const base = process.env.CRONOBLOX_PUBLIC_URL ?? "http://localhost:3017";
const profiles = [spec.profiles.baseline, spec.profiles.solution] as const;

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
    console.log(`${item.id} ${profile.padEnd(8)} ${payload.run_id} ${item.label}`);
  }
}
console.log(`\nEnqueued ${spec.cases.length * profiles.length} runs. Watch them at ${base}, then run \`pnpm evaluate\`.`);
