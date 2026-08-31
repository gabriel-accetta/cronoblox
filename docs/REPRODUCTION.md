# Reproduction guide

Written for someone starting from a clean machine. Four tiers — stop at whichever one answers your
question. Only Tier 3 needs an API key.

## Versions this was built and verified on

| | Version |
| --- | --- |
| Node | 20.10+ (developed on 24.4.1) |
| pnpm | 11.19.0 (pinned via `packageManager`) |
| Docker | any version with Compose v2 |
| PostgreSQL | 16-alpine (via Compose) |
| Redis | 7-alpine (via Compose) |
| Model | `deepseek/deepseek-v4-flash-0731` via OpenRouter |
| `yt-dlp` | latest (`pip install -U yt-dlp`) — only needed for live social research |

Cronoblox reserves ports **3017** (web), **5434** (Postgres), **6381** (Redis) so it does not
collide with other local stacks.

---

## Tier 0 — use the deployed app (0 min, nothing to install)

**<https://cronoblox.duckdns.org>** runs this repository's code on a small VPS.

Paste any Roblox game URL and press **Run the audit** — no account, no API key, the hosted instance
uses its own. A full run takes about 3-5 minutes; **Demo replay** returns instantly from fixtures.
Every run shows its final report, and the **Agent trajectory** tab (or `?view=trajectory`) shows the
complete agent trace behind it.

Prefer to read rather than click? Four representative traces are committed in
[`trajectories/`](../trajectories/).

> The hosted instance is a hackathon preview on modest hardware. If it is slow or unreachable,
> Tier 1 below reproduces the whole workflow locally in about five minutes with no API key.

## Tier 1 — run the full workflow locally with no API key (~5 min)

```bash
git clone https://github.com/gabriel-accetta/cronoblox && cd cronoblox
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev:web      # terminal 1
pnpm dev:worker   # terminal 2
```

Open <http://localhost:3017>, paste any Roblox game URL, and select the **Demo replay** profile.

**Expected output:** a complete run through all eight pipeline states, ending in a structured
report with clickable evidence. Every screen is conspicuously banner-labeled
`CACHED FIXTURE RUN — NOT LIVE PROVIDER DATA`. Deterministic: the same input always produces the
same report. **Runtime ~1s, cost $0.**

This exercises the real engine, the real module runner, and the real evidence gate — only the
provider calls are replaced by fixtures.

## Tier 2 — verify the invariants without running anything (~2 min)

```bash
pnpm typecheck    # strict TypeScript across all workspaces
pnpm test         # deterministic unit + integration suite, no network
pnpm test:e2e     # Playwright critical browser flow
```

**Expected output:** all suites pass. The load-bearing ones are `contracts.test.ts` (the evidence
gate rejects reports citing non-existent records), `registry.test.ts` (module order and profile
gating), `critic-recovery.test.ts` and `engine-recovery.test.ts` (a failed verifier degrades to a
labeled unverified draft instead of failing the run or fabricating a critique).

Optional live canary against the real public Roblox API — not part of `pnpm test`:

```bash
pnpm test:roblox-contract
```

## Tier 3 — one live investigation (~3-5 min, ~$0.004)

Add an OpenRouter key to `.env`, and install `yt-dlp` for social research:

```bash
echo "OPENROUTER_API_KEY=sk-or-v1-..." >> .env
pip install -U yt-dlp
```

Restart the worker, then submit any Roblox game URL on the **Full** profile at **medium** effort.

**Expected output:** a live evidence-linked report in roughly 3-5 minutes. Reported model cost is
persisted per run and shown in the report footer; measured runs land near **$0.004**. Provider
latency dominates — a slow YouTube or Roblox response moves the wall clock more than anything
Cronoblox controls. If the critic times out you will get an explicitly labeled **unverified
draft**; that is the intended degradation, not a failure.

## Tier 4 — reproduce the full baseline-vs-agent evaluation (~30 min, ~$0.05)

The frozen cases live in [`packages/evaluation/cases.json`](../packages/evaluation/cases.json):
ten live Roblox experiences, both profiles, identical effort and user mode.

```bash
pnpm evaluate:sweep   # enqueues 20 runs: 10 baseline + 10 full
pnpm evaluate         # reads them back out of Postgres and writes the comparison
```

`evaluate:sweep` only enqueues — the worker owns execution, so it is safe to interrupt and re-run.
Watch progress at <http://localhost:3017>. When the queue drains, `pnpm evaluate` regenerates
[`evaluation-output/evaluation.md`](../evaluation-output/evaluation.md) and
`evaluation.json` **entirely from persisted run records**. No number in that file is hand-entered,
and no score is hand-assigned — re-running the two commands rebuilds the whole table from scratch.

**Expected runtime:** the 10 baseline runs finish in a few minutes; the 10 full runs take roughly
20-30 minutes depending on worker concurrency (`WORKER_CONCURRENCY`, default 2) and provider
latency. **Expected cost:** about **$0.05** for all 20 runs.

**Expected output:** the headline comparison table, per-case results, and the run id of every run
so any row can be re-opened and audited. Runs that failed are reported as failures rather than
re-rolled.

Because these are live public games, absolute numbers will drift as the games themselves change.
The comparison is paired and run within the same hour, so the **baseline-vs-agent gap** is what
reproduces, not the individual values.

## Data used

Public, game-level Roblox data only: the public game/catalog/discovery endpoints, public YouTube
search results via `yt-dlp`, and publicly fetchable web pages. No player-level data, no
authenticated endpoints, no scraping behind a login, and no credentials in the repository.
