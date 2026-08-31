# Cronoblox

Cronoblox is an evidence-linked Roblox game due-diligence workflow. A user submits one public Roblox game URL, the worker runs the Roblox Data Audit, optional research gathers market and social context, the analyst forms an initial thesis, the critic challenges it, and the web app renders the structured report.

The product never displays a numeric breakout probability — only a categorical breakout potential, which the critic can lower but never raise. Missing providers degrade coverage instead of becoming zeroes or fabricated evidence.

## Architecture

This is a strict TypeScript pnpm monorepo and a modular monolith with one background worker:

- `apps/web`: Next.js App Router UI and stable JSON endpoints
- `apps/worker`: BullMQ worker that owns the long-running investigation
- `packages/contracts`: shared Zod schemas
- `packages/db`: PostgreSQL / Drizzle schema, migrations, and repositories
- `packages/module-sdk`: explicit module registry and validated runner
- `packages/evidence`: append-only evidence helpers
- `packages/modules/*`: Roblox data, market intelligence, and critic modules
- `packages/sources/*`: Roblox, YouTube (via yt-dlp), and generic webpage-fetch provider adapters
- `packages/llm`: OpenRouter structured-output adapter plus visibly labeled deterministic fixture adapter
- `packages/engine`: persisted, code-controlled state machine
- `packages/evaluation`: frozen cases, human rubric, JSON/Markdown export

Redis is queue infrastructure only. PostgreSQL stores the immutable profile snapshot, states, events, evidence, raw provider payloads, reports, and evaluation records.

## Clean setup

Prerequisites: Node 20.10+, pnpm 11+, and Docker Desktop.

```powershell
Copy-Item .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
```

Add `OPENROUTER_API_KEY` for live synthesis. The default `OPENROUTER_MODEL` is `deepseek/deepseek-v4-flash-0731`; any compatible OpenRouter model slug with tool-calling support can be configured instead (the whole pipeline is now a real tool-calling agent loop, not a single structured-output call). There is no general web-search tool — social/creator coverage comes from YouTube only (no key needed; it runs through the `yt-dlp` CLI, which must be installed on the machine running the worker — `pip install -U yt-dlp`; override the binary path with `YT_DLP_PATH`). No secrets are sent to the browser.

Start the web app and worker in separate terminals:

```powershell
pnpm dev:web
pnpm dev:worker
```

Open `http://localhost:3017`. Cronoblox reserves local ports `3017` (web), `5434` (PostgreSQL), and `6381` (Redis). Select **Demo replay** to exercise the complete workflow without paid API keys. Fixture runs and reports are conspicuously labeled and never presented as live evidence.

## Commands

```powershell
pnpm typecheck       # strict TypeScript across workspaces
pnpm test            # deterministic unit and integration checks
pnpm test:roblox-contract # optional live public-endpoint contract smoke test
pnpm test:e2e        # critical browser flow (install Chromium once if needed)
pnpm build           # production Next.js build + worker checks
pnpm evaluate        # emit unscored JSON and Markdown evaluation templates
```

Evaluation output is written to `evaluation-output/`. Human-required rubric fields intentionally remain unscored. Run baseline and `full` against the same frozen cases, preserve failures, then enter review scores. The baseline receives only the Module 2 current-data bundle and one direct assessment call.

## Runtime and cost

### Bring your own AI

The landing page's **Add to your AI** card offers a Claude plugin, ChatGPT setup, an OpenAI desktop plugin bundle, and generic MCP configuration. The public, data-only `/mcp` endpoint reuses Cronoblox's Roblox audit and research tools without invoking any models or creating a paid run. The user's AI client performs analysis under its own plan limits. Tools require no account or API key during this hackathon preview.

Set `CRONOBLOX_PUBLIC_URL` to the deployed HTTPS origin before sharing plugins. Install `yt-dlp` on the **web host** for YouTube search. Cloud clients cannot reach a local development URL. Custom installation is implemented; public directory listing still requires platform review. See [MCP deployment, installation and limits](docs/mcp.md).

### Hosted investigations

Module 2 usually takes seconds. A full run depends on provider latency and the configured four-minute budget. The default profile caps external calls at 18 and critic cycles at two. OpenRouter token usage is stored with the trajectory; model prices change, so the adapter does not invent an estimated cost when a validated price table is unavailable.

## Scope boundaries

Intentionally deferred: historical collection, ML forecasting, Roblox client automation, screenshots/vision, watchlists, alerts, portfolios, and acquisition decisions. Public Roblox endpoints may change; failures are recorded as degraded evidence. Badge interpretations must remain labeled inferences.
