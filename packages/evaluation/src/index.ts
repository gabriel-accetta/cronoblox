import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(resolve(here, "../cases.json"), "utf8"));
const rubric = JSON.parse(await readFile(resolve(here, "../rubric.json"), "utf8"));
const timestamp = new Date().toISOString();
const output = { generated_at: timestamp, status: "UNSCORED — human review required", resource_note: "Baseline receives current Module 2 data plus one direct model call; full runs additionally receive enabled research, evidence workspace support, and critic verification.", cases: cases.cases.map((item: Record<string, unknown>) => ({ ...item, baseline_run_id: null, full_run_id: null, rubric: structuredClone(rubric.dimensions), measurements: { runtime_ms: null, estimated_cost_usd: null, provider_failures: null, evidence_coverage: null, unsupported_claims: null } })) };
const outputDir = resolve(here, "../../../evaluation-output"); await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "evaluation.json"), JSON.stringify(output, null, 2));
const markdown = [`# Cronoblox evaluation`, ``, `Generated: ${timestamp}`, ``, `Status: **UNSCORED — human review required**`, ``, output.resource_note, ``, `| Case | Role | Baseline | Full | Human score |`, `| --- | --- | --- | --- | --- |`, ...output.cases.map((item: Record<string, unknown>) => `| ${item.label} | ${item.role} | pending | pending | unscored |`), ``, `Run live cases through the baseline and full profiles, preserve every failure, then enter human scores in the JSON export.`].join("\n");
await writeFile(resolve(outputDir, "evaluation.md"), markdown);
console.log(`Wrote unscored evaluation templates for ${output.cases.length} frozen cases to ${outputDir}`);
