# Cronoblox

**Evidence-linked analysis for Roblox games.** Submit one public game URL. A pipeline of
agents audits the game, researches its market, argues against its own conclusion, and returns a
report where **every claim opens the source it came from**.

No numeric breakout probability is ever shown, only a categorical rating, which the critic agent
can hold or lower, never raise.

### ▶ Try it live — <https://cronoblox.duckdns.org>

Deployed and running. No install, no account, no API key: paste a Roblox game URL and watch the
agents work.

---

## Quick links for micro1 hackathon

| | |
| --- | --- |
| **Live demo** — run it yourself, nothing to install | **<https://cronoblox.duckdns.org>** |
| **Solution video (5 min)** | https://YOUR-VIDEO-LINK |
| **Evaluation** — baseline vs. agent, 10 frozen cases | [`evaluation-output/evaluation.md`](evaluation-output/evaluation.md) |
| **Improvement changelog** + failure mode + hot take | [`IMPROVEMENT_CHANGELOG.md`](IMPROVEMENT_CHANGELOG.md) |
| **Agent trajectories** | [§ Agent trajectories](#agent-trajectories) |
| **Reproduction guide** (clean environment) | [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md) |
| **Agent instructions** (the system prompts) | [orchestrator](packages/modules/orchestrator/src/index.ts#L23) · [data agent](packages/modules/data-agent/src/index.ts#L19) · [socials agent](packages/modules/market-intelligence/src/index.ts#L26) · [critic](packages/modules/critic/src/index.ts#L11) |
| **Architecture for engineers** | [`AGENTS.md`](AGENTS.md) |

Everything in this repository was built during the hackathon window, first commit `2026-08-29`.
No pre-existing components beyond open-source libraries.

---

## The problem

**Who.** Roblox developers and studios deciding whether to keep pouring resources 
into one of their own, and game investors and publishers deciding whether to 
acquire or fund a game.

**The bottleneck.** A game's discovery-chart position and current player count tell you almost
nothing about whether it will still matter in three months. Separating a durable hit from an
update-spike takes hours of manual work across the game page, YouTube, comparable titles and
community activity, and two analysts doing it reach different conclusions with no shared method.
The tempting shortcut is to ask a chatbot, which returns a confident paragraph you cannot check.

**Why it matters.** These are real acquisition and staffing decisions. A wrong call on a game
that spiked and faded is expensive, and "the AI said it looked strong" is not a defensible basis
for one. What the user actually needs is not a faster opinion, it is an opinion they can audit.

---

## Results

Ten live Roblox games, each run twice within the same hour: once on a simple baseline (same model,
same data, one direct call) and once on the full agent workflow. Identical URL, effort and user
mode. Every number below is computed from persisted run records by `pnpm evaluate`.

| Metric | Simple baseline | Agent solution | Change |
| --- | ---: | ---: | ---: |
| **Independent sources behind the verdict** (primary) | 1.0 | 30.6 | **31×** |
| Evidence records per report | 5.0 | 47.6 | +42.6 |
| Claims traceable to a source | 95.7% | 97.5% | +1.9 pts † |
| Downside claims per report | 2.8 | 3.4 | +0.6 |
| Objections raised by verification | 0 | 28 | +28 |
| Ratings lowered after verification | 0 — structurally impossible | 4 / 10 | — |
| Runs degraded to a labeled unverified draft | n/a | 1 / 10 | — |
| Human time per task | ~30-45 min manual | 3m22s unattended | — |
| Runtime per task | 26.2s | 3m22s | +176.1s |
| Cost per task | $0.0005 | $0.0050 | +0.0045 |

† **The traceability number is flat on purpose, and it is the most interesting row here.** The
baseline is already ~96% "traceable" — but every one of its claims traces back to the same single
bundle it was handed: the game's own Roblox listing. Traceability without independence is
self-reference. That is why the primary metric is the number of *distinct* sources a reader can
open, where the gap is not a few points but a multiple.

Full per-case results, the hard case, preserved failures and every run id:
[`evaluation-output/evaluation.md`](evaluation-output/evaluation.md)

### What made the difference

Three changes did three different things, and only two of them move a number.

**The critic changed the answer.** In **4 of 10 cases** it lowered the rating after verification, and
it raised 28 objections the user would otherwise never see. On the hard case it caught a claim
anchored to evidence about a *different game*. This is the largest contribution to decision quality —
and the baseline cannot do it at all, since a single pass has nothing to check itself against.

**Delegation made the verdict auditable.** Sub-agents took independent sources per report from
**1.0 to 30.6**. The baseline's one source is the game's own Roblox listing — it is a summary of what
the game says about itself.

**The evidence gate moves no metric, and that is the point.** `assertReportEvidence` and
`keepKnownIds` are a floor, not a lift: they make it impossible to ship a report citing a record that
does not exist. Measured traceability is nearly flat because neither profile fabricates ids — the
gate is why that stays true under a model change, not something it improved.

**The experiment removed:** a numeric breakout probability. It was the most compelling-looking output
in the product and the first thing users asked for — and there is no legally usable labeled history of
Roblox breakouts to calibrate it against. Two digits of precision implied a validated model that did
not exist, so it was replaced with a categorical rating.

Full stage-by-stage story → [`IMPROVEMENT_CHANGELOG.md`](IMPROVEMENT_CHANGELOG.md)

---

## Agent trajectories

Cronoblox ships its own trajectory viewer — [try it on the live site](https://cronoblox.duckdns.org). Open any run and switch
to the **Agent trajectory** tab, or append `?view=trajectory` to the URL. It shows every model turn,
every tool call **with its real arguments**, every tool response time, token counts, the reason a
loop was forced to wrap up, and any retry — for all four agents in one timeline.

| Agent | What it does | Instructions |
| --- | --- | --- |
| `orchestrator` | Forms the thesis; decides what research is worth delegating | [prompt](packages/modules/orchestrator/src/index.ts#L23) |
| `data-agent` | Roblox catalog, discovery charts, comparable titles | [prompt](packages/modules/data-agent/src/index.ts#L19) |
| `market-intelligence` | YouTube creator coverage and attention diversity | [prompt](packages/modules/market-intelligence/src/index.ts#L26) |
| `critic` | Attacks the thesis; may hold or lower the rating, never raise it | [prompt](packages/modules/critic/src/index.ts#L11) |

### Representative runs

| Trajectory | What it shows |
| --- | --- |
| [Rogue Lineage — baseline](trajectories/rogue-lineage-baseline.md) | 14 steps, 1 source, no verification. The control condition. |
| [Rogue Lineage — full](trajectories/rogue-lineage-full.md) | 94 steps, 4 agents, 39 sources. The critic **lowered** MODERATE → LOW. |
| [Merge a Spinner! — full](trajectories/upd-2-merge-a-spinner-full.md) | The hard case. The critic catches a claim anchored to evidence about a *different game*. |
| [+1 Cut Grass Adventure — full](trajectories/1-cut-grass-adventure-full.md) | Verification times out; the run degrades to a labeled **unverified draft** instead of faking a critique. |

The evaluation's [run ids](evaluation-output/evaluation.md#run-identifiers) come from the sweep
instance that produced the table — the public demo keeps its own database, so open those on the
instance that ran them, or regenerate them locally with the two commands below.

These four are exported to [`trajectories/`](trajectories/) so they can be read without running
anything — regenerate any run with `pnpm trajectory <run-id>`.

---

## Reproduce it

**Fastest path — zero install:** open **<https://cronoblox.duckdns.org>**, paste any Roblox game URL, press
Run the audit. That is the same code as this repository, deployed.

Full instructions, versions, expected output, runtime and cost: [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md)

**Run it locally instead — no API key, ~5 minutes:**

```bash
git clone https://github.com/gabriel-accetta/cronoblox && cd cronoblox
cp .env.example .env && docker compose up -d
pnpm install && pnpm db:migrate && pnpm db:seed
pnpm dev:web      # terminal 1
pnpm dev:worker   # terminal 2
```

Open <http://localhost:3017>, paste any Roblox game URL, select the **Demo replay** profile. Real
engine, real evidence gate, deterministic fixture providers — every screen labeled as such.

**Reproduce the evaluation** (needs an `OPENROUTER_API_KEY`, ~30 min, ~$0.05):

```bash
pnpm evaluate:sweep   # enqueues 10 baseline + 10 full runs
pnpm evaluate         # rebuilds the comparison table from persisted records
```

---

## How it works

```
POST /api/runs → BullMQ → worker → executeRun()
     │
     ├─ COLLECT_CORE   roblox-data          mandatory audit, always first, never skippable
     ├─ PLAN/EXECUTE   orchestrator         forms the thesis; may call two sub-agents as tools
     │                   ├─ data-agent          Roblox catalog + discovery charts
     │                   └─ market-intelligence YouTube creator coverage
     ├─ CRITIQUE       critic               attacks the thesis; can only hold or LOWER the rating
     ├─ ROUTE                               loops orchestrator↔critic while objections stand
     └─ FINALIZE       assertReportEvidence  refuses any report citing evidence that doesn't exist
```

The design choices that carry the most weight:

- **Top-level orchestration is code, not a model.** A persisted state machine picks the steps; the
  model plans only *within* a step. No run can silently skip the data audit.
- **Evidence is a persisted record, not a citation string.** Every tool call that returns real data
  writes one, and every claim must resolve to a real id — enforced at assembly, not requested in a prompt.
- **Verification is asymmetric.** The critic may lower a rating, never raise it. A verifier that can
  also promote is just a second optimist.
- **Degrade loudly.** A missing provider becomes a warning and `status: degraded`; a critic that times
  out yields an explicitly labeled **unverified draft**, never a fabricated critique.
- **One budget for the whole run.** External calls and cost are capped run-wide, not per module.
- **Profiles are snapshotted onto the run and never mutated**, so a run stays reproducible after
  defaults change.

Strict TypeScript pnpm monorepo, modular monolith plus one background worker. Postgres is
authoritative for all durable state; Redis is queue infrastructure only. Package-by-package map in
[`AGENTS.md`](AGENTS.md).

---

## Hot take

**Reliability in agent systems comes from what the pipeline refuses to do, not from what the model
is asked to do.** Every accuracy problem here was ultimately solved by moving a rule out of the
prompt and into code that can reject the model's output. The prompts got *shorter* as the system
got more reliable. The main failure mode this taught me to fear: **an optional verification step
that fails silently** — a timed-out critic and a fabricated critique present to the user as exactly
the same confident report, and only one of them is honest about what was checked.

Longer version, with the incident that caused it →
[`IMPROVEMENT_CHANGELOG.md`](IMPROVEMENT_CHANGELOG.md) · [`docs/run-reliability.md`](docs/run-reliability.md)

---

## Also included

**Bring your own AI.** A public, data-only MCP endpoint at **`https://cronoblox.duckdns.org/mcp`**
([docs](docs/mcp.md)) exposes the Roblox audit and research tools to Claude, ChatGPT or any MCP
client, with no models invoked and no paid run created. Setup cards are on the
[landing page](https://cronoblox.duckdns.org).

## Scope and limits

Public, game-level data only — no player-level data, no authenticated endpoints, no credentials in
this repository. Intentionally out of scope: historical collection, ML forecasting, Roblox client
automation, vision, watchlists, alerts and portfolio management. Public Roblox endpoints are
undocumented and may change; failures are recorded as degraded evidence rather than hidden. Badge
and rating interpretations are labeled inferences, not facts. The final decision stays with a human.
