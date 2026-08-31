# Improvement changelog

How Cronoblox got from a single prompt to an evidence-gated multi-agent workflow, including the
experiments that were removed. Every number here comes from
[`evaluation-output/evaluation.md`](evaluation-output/evaluation.md), regenerated from persisted run
records by `pnpm evaluate` — nothing is hand-entered.
Run ids are real and re-openable — append `?view=trajectory` to any run URL to read its agent trace.

| Stage | What was tried, and why | Evidence | Decision / learning |
| --- | --- | --- | --- |
| **Baseline** | One direct model call over the mandatory Roblox data bundle. The cheapest honest way to answer "is this game about to break out?" — same model, same input data, no delegation, no verification. Kept in the product as the `baseline` profile so the comparison stays runnable, not just described. | 1.0 source, 5.0 evidence records, 2.8 downside claims per report; 26.2s, $0.0005 | Established the starting point. It answers fast and confidently, and almost nothing it says can be traced back to a source. |
| **Iteration 1 — evidence records as the unit of work** | Baseline output read as authoritative prose with no way to check it. Introduced an append-only `Evidence` record (`claim`, `source`, `observation`, `derivation`, `support_strength`, `relationship`) that every tool call must emit, and made every claim reference evidence ids. | `packages/evidence`, `packages/contracts` `EvidenceSchema` | **Kept.** Evidence had to become a first-class persisted object, not a citation string, before anything downstream could be verified. |
| **Iteration 2 — a hard gate, not a better prompt** | Models still cited evidence ids that did not exist. Prompting for accuracy did not fix it. Added `assertReportEvidence`, which refuses to assemble a report if any cited id is not a persisted record, and `keepKnownIds`, which strips unknown ids at every agent boundary. | `assertReportEvidence` in `packages/contracts`; `tests/contracts.test.ts` | **Kept — but it moves no metric, and that is the point.** Measured traceability is nearly flat (95.7% → 97.5%) because neither profile fabricates ids *any more*. The gate is a floor, not a lift: it is why that stays true when the model or the prompt changes. Reliability work that shows up as a flat line is still the work. |
| **Iteration 3 — delegation to sub-agents** | One agent doing Roblox data, comparables and social research in a single context did all three shallowly. Split into `data-agent` (catalog/charts) and `market-intelligence` (YouTube/web), invoked by the orchestrator as tools. | independent sources per report **1.0 → 30.6 (31×)**; evidence records 5.0 → 47.6 | **Kept.** More sources per report, and each research thread keeps its own focused context. |
| **Iteration 4 — orchestration moved out of the model** | Letting the model decide which top-level modules to run produced runs that silently skipped the data audit. Moved top-level order into a persisted, code-controlled state machine; the model now only plans *within* a step. | `packages/engine` `RunState` machine; `tests/registry.test.ts` | **Kept.** Agency at the step level, determinism at the pipeline level. Every run reaches the same states in the same order, which is also what makes runs reproducible. |
| **Iteration 5 — an adversarial critic that can only lower** | Research made reports richer but no less confident. Added a `critic` agent that re-reads the thesis against stored evidence and raises objections, with an asymmetry: it may hold or lower `breakout_potential`, never raise it. | **28 objections** across 10 runs; the rating was **lowered in 4 of 10** cases | **Kept.** A verifier that can also promote is a second optimist. The asymmetry is what makes the pass adversarial. |
| **Iteration 6 — timeouts became silent failures** | Live run `59caef44-3216-42be-afc7-aacbd590e3dd` failed at the critic with `This operation was aborted`, ~95s after its evidence lookups, discarding a completed thesis and all research. The loop persisted no model-call timings, so the cause could not be reconstructed. | [`docs/run-reliability.md`](docs/run-reliability.md) | **Kept.** Added a 90s per-turn deadline, a 4,096-token output cap, per-turn timing/token events, and one schema-validated recovery request when a model ignores forced submission. Verified live on `ee7e1c3d-3a08-4e7a-b528-8c87a4de60f4` (4m43s, $0.003566). |
| **Iteration 7 — degrade loudly instead of failing** | Even with the deadline, an optional verifier can still time out. The tempting fixes — retry silently, or synthesize a critique — both lie about what happened. | `tests/critic-recovery.test.ts`, `tests/engine-recovery.test.ts` | **Kept.** A failed critic now yields an explicitly labeled **unverified draft** (`verification_status: "incomplete"`) with the research intact. The run neither fabricates a critique nor throws away work. |
| **Removed — numeric breakout probability** | A single percentage was the most compelling-looking output in the product, and the one users asked for first. | No legally usable labeled history of Roblox breakouts exists to calibrate against | **Removed.** Two digits of precision implied a validated model behind them. Replaced with a categorical `LOW / MODERATE / HIGH / VERY HIGH`. The most persuasive output was the one that could not be grounded. |
| **Removed — Redis as state store** | Runs already passed through BullMQ, so keeping state there looked like one less dependency. | Interrupted runs could not be resumed or re-read | **Removed.** Postgres is authoritative; Redis is queue infrastructure only and holds no domain state. Reproducibility required durable state. |
| **Removed — general web search in the research loop** | A broad search tool promised wider coverage of a game's reception. | Results were dominated by SEO game-list pages that cite no primary source | **Removed** from the research path. Social coverage comes from YouTube, where a view count is itself a signal. Breadth that cannot be attributed is not coverage. |
| **Final** | Code-controlled state machine → mandatory data audit → orchestrator with two delegated research agents → adversarial critic → evidence-gated report assembly, under one shared run-wide budget. | [full comparison table](evaluation-output/evaluation.md) | **The critic is the largest measured contribution** — it is the only component that changed the answer (4 of 10 ratings lowered). Delegation is what made the answer auditable (31× sources). The evidence gate improved no metric and was still necessary: it removes a failure mode rather than raising a score. |

## What the hard case revealed

`Merge a Spinner!` is the frozen hard case, and it changed how I think about the evidence gate. The
agent produced a claim — *"no top-tier influencer has covered this game"* — that cited a **real,
persisted evidence record**. The gate passed it, correctly: the record existed. The critic then
caught what the gate structurally cannot: the record documented a 339K-view video about a
*different game*.

The failure mode that survives an evidence gate is not fabrication. It is **misattribution** — a
claim pointing at evidence that exists but does not support it. A gate can only check existence.
Checking support is a judgement, and it needs a second agent whose whole job is to withhold
agreement.

## Main failure mode

**An optional verification step that fails silently is worse than no verification.** The first
version of the critic could time out mid-run and take an already-completed thesis down with it,
and an earlier version would have been trivial to "fix" by having the model write a critique from
memory. Both failure shapes present the same way to the user: a confident report. Only one of them
is honest about what was actually checked.

## Hot take

**Reliability in agent systems comes from what the pipeline refuses to do, not from what the model
is asked to do.** Every accuracy problem here was eventually solved by moving a rule out of the
prompt and into code that can reject the model's output: unknown evidence ids get stripped at
agent boundaries, reports that cite non-existent records cannot be assembled, a verifier is
structurally unable to raise a rating, and a failed verification is forced to surface as a labeled
unverified draft. The prompts got *shorter* as the system got more reliable. Next time I would
write the invariant and its failing test before writing the agent that has to satisfy it.
