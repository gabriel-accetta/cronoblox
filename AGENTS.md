# AGENTS.md

Cronoblox: evidence-linked Roblox game due-diligence tool. User submits a public Roblox game URL; a background worker runs a fixed pipeline (mandatory data audit → LLM orchestrator agent, optionally delegating to sub-agents → optional critic agent) and produces a structured, evidence-cited report. No numeric "breakout probability" is ever shown — only categorical `breakout_potential` (LOW/MODERATE/HIGH/VERY HIGH) and `confidence` (LOW/MEDIUM/HIGH), kept as separate axes. Missing providers degrade coverage (warnings) instead of fabricating data or zeroing metrics.

Strict TypeScript pnpm monorepo, modular monolith + one background worker. All packages are `@cronoblox/*`, ESM, `main`/`types` point straight at `src/index.ts` (no build step for libs — consumed as source via workspace deps).

## Request lifecycle

1. **`apps/web`** (Next.js App Router, port 3017) — `POST /api/runs` validates `AnalysisInputSchema` (Zod), loads an immutable `ProfileSnapshot` from `packages/config`, creates a `runs` row (Postgres, via `packages/db`), enqueues a BullMQ job (Redis). `GET /api/runs/[id]`, `.../events`, `.../evidence` poll state for the UI (`apps/web/app/runs/[id]/page.tsx`).
2. **`apps/worker`** — a BullMQ `Worker` that just calls `executeRun(runId)` from `packages/engine`. Redis/BullMQ is queue infrastructure only; it holds no domain state.
3. **`packages/engine`** (`src/index.ts`) drives a persisted, code-controlled state machine (`RunState`: `QUEUED→COLLECT_CORE→PLAN→EXECUTE→RECORD→SYNTHESIZE→CRITIQUE→ROUTE→FINALIZE→COMPLETED|FAILED|CANCELLED`) and runs modules through `ModuleRunner` **in a fixed, hardcoded order** — no LLM chooses which top-level modules run:
   - `roblox-data` (required) — mandatory first call, always runs before anything else.
   - `orchestrator` (required) — an LLM agent that forms the `Thesis`. May optionally call `data-agent` / `market-intelligence` as tools.
   - `critic` (optional, profile-gated) — verifies the thesis; if it raises unresolved high-severity objections, the engine loops orchestrator→critic again (up to `profile.limits.max_critic_cycles`), then applies `evaluateStoppingRule` (`packages/engine/src/stopping.ts`).
   - `FINALIZE` assembles the `Report`, and `assertReportEvidence` (in `packages/contracts`) throws if any claim/evidence id in the report isn't a real, persisted evidence record — the anti-hallucination gate of last resort.
4. Postgres (`packages/db`, Drizzle) stores everything durable: runs, run_modules, run_steps, run_events, raw_artifacts, evidence, reports, provider_cache, evaluation_scores, analysis_profiles. Redis/BullMQ never stores results.

## Module system (packages/module-sdk)

Every pipeline step is a `CronobloxModule<TInput, TOutput>` = `{ manifest, inputSchema, outputSchema, execute(input, context) }`. `ModuleRegistry.register(...)` collects them (see `packages/engine/src/index.ts` for the registry + P0 order); `ModuleRunner.run(id, input, ctx)` validates input/output against the module's Zod schemas, persists the result + evidence, and returns a `ModuleResult`. `ModuleContext` gives a module: the immutable `profile`, an `AbortSignal` tied to `max_runtime_ms`, evidence read/write, raw-artifact storage, event emission, the shared `budget`, and `runModule()` so one module (the orchestrator) can invoke another as a sub-call.

## Agents (packages/agent-core, agent-tools)

`agent-core/src/loop.ts` (`runAgentLoop`) is a **domain-agnostic** hand-rolled tool-calling loop over the OpenAI SDK pointed at OpenRouter (`createOpenRouterClient`, `agent-core/src/client.ts`): call the model → execute requested tools → feed results back → repeat until it calls the designated `submit` tool, or budget/iterations force a final forced-submit turn. Every module that calls an LLM (`orchestrator`, `data-agent`, `market-intelligence`, `critic`) is a thin wrapper around this loop with its own system prompt, tool set, and submit schema.

A single `RunBudget` (`createRunBudget`, in agent-core) is shared across *every* agent loop in a run — external calls and cost are capped run-wide, not per-module; each module gets its own `AgentBudget` view via `withIterationCap`.

`packages/agent-tools` builds the actual `AgentTool`s (`fetch_page`, `youtube_search`, `roblox_search_peers`, `roblox_list_trending_charts`, `roblox_get_chart_games`, `get_evidence_by_id`) on top of `packages/sources/*`. Every tool call that returns real data pushes an `Evidence` record via `createEvidence`. `keepKnownIds()` strips any evidence/claim id an LLM cites that doesn't correspond to a real record — applied at every agent boundary (orchestrator output, critic output), not just at final report assembly.

## Evidence model (packages/contracts, packages/evidence)

`Evidence` = `{ claim, source: {type, url, retrieved_at, cache_key}, observation, derivation, support_strength: low|medium|high, relationship: supports|contradicts|contextualizes|unresolved, used_by, ... }`. `createEvidence` builds a leaf record from a real source call; `deriveEvidence` builds a computed record (e.g. like ratio) that cites the raw evidence it was derived from. Every `Thesis` claim and every `Report` field must resolve to real evidence ids — enforced by `assertReportEvidence`.

## Package map

| Package | Purpose |
|---|---|
| `apps/web` | Next.js UI + stable JSON API routes (`app/api/runs/**`) |
| `apps/worker` | BullMQ worker; only entry point that calls `executeRun` |
| `packages/contracts` | All shared Zod schemas/types — single source of truth for every data shape (RunState, Evidence, ProfileSnapshot, Thesis, Report, ...) |
| `packages/module-sdk` | `CronobloxModule` interface, `ModuleRegistry`/`ModuleRunner` |
| `packages/engine` | The state machine that runs modules in P0 order and builds the final `Report` |
| `packages/agent-core` | Domain-agnostic LLM tool-calling loop + OpenRouter client + shared run budget |
| `packages/agent-tools` | Cronoblox-specific `AgentTool`s wrapping `packages/sources/*`, emitting `Evidence` |
| `packages/modules/roblox-data` | Required core module: audits the Roblox game, computes derived metrics |
| `packages/modules/orchestrator` | Required core module: LLM agent that forms the `Thesis`, may delegate |
| `packages/modules/data-agent` | Optional sub-agent: deeper Roblox catalog/chart research |
| `packages/modules/market-intelligence` | Optional sub-agent: YouTube/web social research |
| `packages/modules/critic` | Optional verifier agent: raises objections, can revise the thesis loop |
| `packages/sources/roblox` | Roblox public game/catalog/explore endpoint adapter |
| `packages/sources/youtube` | YouTube search via `yt-dlp` CLI (no API key/quota; needs the binary installed) |
| `packages/sources/webpage` | Generic URL fetch + readable-text extraction (`html-to-text`) |
| `packages/sources/brave` | Brave web search adapter (optional API key; used by critic) |
| `packages/evidence` | `createEvidence`/`deriveEvidence` helpers — canonical evidence construction |
| `packages/db` | Drizzle schema + repository functions over Postgres |
| `packages/config` | The four fixed, immutable `ProfileSnapshot`s (see below) |
| `packages/llm` | `FixtureAnalyst` — deterministic keyless thesis generator, used only by `demo-replay` |
| `packages/evaluation` | Runs frozen test cases, emits unscored JSON/Markdown for human rubric review |

## Profiles (packages/config)

Four fixed profiles select which modules/tools run and the run's limits; a profile is **snapshotted onto the run at creation and never mutated afterward** (`run.profileSnapshot`, immutable JSONB):
- `baseline` — roblox-data + orchestrator only, no delegation, no critic (control condition).
- `research-no-critic` — orchestrator may delegate to data-agent/market-intelligence, no critic.
- `hackathon-full` — full pipeline including critic revision cycles.
- `demo-replay` — deterministic cached fixture evidence via `FixtureAnalyst`, no API keys required, no live provider calls; every fixture output is explicitly labeled as such and must never be presented as live evidence.

## Conventions / invariants an agent must preserve

- Add a new pipeline step by implementing `CronobloxModule` and registering it in `packages/engine/src/index.ts` — do not bypass `ModuleRunner` (it's what validates schemas and persists evidence).
- Never let a claim, objection, or report field reference an evidence/claim id without it existing in the run's persisted evidence — use `keepKnownIds` at any new agent boundary.
- `ProfileSnapshot` objects are immutable once a run holds one; add new capabilities as new profile entries or new `enabled_modules`/`enabled_tools`, don't mutate an existing profile's meaning retroactively.
- Degrade, don't fabricate: a missing API key or failed provider call should produce a `warnings` entry / `status: "degraded"`, never a fabricated value or a silently-zeroed metric.
- All cross-package data shapes live in `packages/contracts` — extend schemas there first, then flow the type through.

## Root-level non-package folders

- `tests/` — Vitest suite (`vitest.config.ts` includes only `tests/**/*.test.ts`, not colocated specs). All deterministic, no real DB/Redis/LLM/network. `contracts.test.ts` (evidence schema, append-only, `assertReportEvidence`), `registry.test.ts` (module order/uniqueness/profile gating), `stopping.test.ts` (`evaluateStoppingRule` table tests), `sources.test.ts` (`parsePlaceId` URL parsing), `openrouter.test.ts` (stubs `fetch` to assert `runAgentLoop` hits OpenRouter correctly), `fixture-flow.test.ts` (runs the real `registry`/`ModuleRunner` through the `demo-replay` profile end-to-end — the closest thing to an integration test here).
- `e2e/home.spec.ts` — Playwright, driven by `playwright.config.ts` (spins up `pnpm dev:web` on `127.0.0.1:3017`). Mocks `/api/runs*` at the network layer with hand-built fixture `run`/`evidence`/`report` payloads, so it tests `apps/web`'s rendering/polling, not a real worker run.
- `scripts/roblox-contract-smoke.ts` — the one test that hits the **real** live Roblox API (`pnpm test:roblox-contract`, not part of `pnpm test`/CI-blocking). A canary for undocumented-endpoint drift.
- `packages/evaluation/` + `evaluation-output/` — two halves of one thing. `packages/evaluation/{cases.json,rubric.json}` are frozen hand-authored cases + rubric dimensions; `pnpm evaluate` reads them and writes `evaluation-output/evaluation.{json,md}` as **unscored templates** (`baseline_run_id`/`full_run_id`/measurements all null). It runs no analyses itself — the workflow is: manually run each case through `baseline` and `hackathon-full`, fill in real run ids/measurements, then a human scores the rubric. `evaluation-output/` is generated output, not source.
- `docker-compose.yml` — only the two stateful deps for local dev: `postgres:16-alpine` (`5434→5432`) and `redis:7-alpine` (`6381→6379`), named volumes + healthchecks. `apps/web`/`apps/worker` are never containerized; always run via `pnpm dev:*`.

## Commands

```
pnpm typecheck        # strict TS across all workspaces
pnpm test             # vitest unit/integration
pnpm test:e2e         # playwright critical flow
pnpm test:roblox-contract  # optional live public-endpoint smoke test
pnpm dev:web / dev:worker  # run app + worker in separate terminals
pnpm db:migrate / db:seed
pnpm evaluate         # emit unscored eval JSON/Markdown to evaluation-output/
```

Local ports (fixed, non-default to avoid clashing with other stacks): web `3017`, Postgres `5434`, Redis `6381`. `OPENROUTER_API_KEY` required for any non-fixture profile; `BRAVE_SEARCH_API_KEY` optional (web search degrades without it); YouTube needs no key but needs `yt-dlp` installed on the worker host.
