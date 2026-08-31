# Cronoblox in your own AI client

The public MCP path supplies evidence to an external AI client. The client performs reasoning under the user's plan limits. Cronoblox makes zero model calls, never enqueues an investigation, and does not save the client's conclusions as a worker report. Hosting and data collection still consume infrastructure resources.

## Deployment

1. Deploy the existing Next.js web app to a **Node.js host** with a public HTTPS address. No separate MCP process is needed.
2. Set `CRONOBLOX_PUBLIC_URL` to that origin, with no path. This is required behind reverse proxies so downloaded plugins contain the correct endpoint instead of an internal hostname.
3. Install `yt-dlp` on the **web host** (or set `YT_DLP_PATH`). The worker installation alone is insufficient. YouTube requires a runtime that permits child processes; missing/broken providers produce explicit errors. Do not use an edge-only runtime.
4. Allow at least 60 seconds per HTTP request. The MCP route is `/mcp`; no auth or API key is required for this public demo.
5. Open the landing card and check its URL, download each bundle and connect a client. Local preview URLs are deliberately marked as unusable from cloud AI clients.

This path needs neither PostgreSQL, Redis nor an OpenRouter key. The existing hosted investigation flow is unchanged and still needs its usual services. No real deployment, publication or external-account installation happens merely by building the repository.

## Code boundaries

- `packages/mcp/src/tools.ts`: bounded public tool schemas and adapters over existing data operations. No engine, DB, queue or model imports.
- `packages/mcp/src/runtime.ts`: process-local quotas, concurrency, request cancellation, coalescing and short-lived caching.
- `packages/mcp/src/server.ts`: official MCP SDK; stateless Streamable HTTP with JSON responses, tool discovery, input/output validation, safe errors, workflow resource and prompt.
- `packages/mcp/src/distribution.ts`: builds deployment-specific Claude/OpenAI ZIPs from one skill. It never edits the user's installed plugins or personal marketplace.
- `apps/web/public/integrations/investigate-roblox/SKILL.md`: canonical skill, also downloadable on its own and exposed through MCP.
- `apps/web/app/mcp/route.ts`: Node.js transport entry point. `GET`/`DELETE` return 405 because this stateless service has no persistent SSE channel or sessions.
- `apps/web/components/integration-card.tsx`: accessible installation dialog, clipboard/manual-copy controls and client instructions.

The worker continues to run `robloxDataModule` through `ModuleRunner`. Both the module and MCP call the shared `collectRobloxData` data operation, so metric calculations and evidence generation remain in one place. MCP validates the audit output without creating a durable run.

## Tools and evidence

| Tool | Capability |
| --- | --- |
| `cronoblox_audit_game` | Resolve game identity and collect current Roblox metrics and candidate peers |
| `cronoblox_search_peers` | Search the Roblox catalog for candidate comparables |
| `cronoblox_list_charts` | Discover chart names and sort IDs |
| `cronoblox_get_chart_games` | Read a chart using a returned sort ID |
| `cronoblox_search_youtube` | Up to five creator-coverage results; no transcripts or publish dates |

Successful results include `data`, full `evidence` records, `observed_at`, `warnings`, `cached` and `model_calls: 0`. Failures use MCP `isError` and safe messages, never fabricated evidence. Cached results retain their original observation times. Discovery endpoints are undocumented and may return truncated exploratory data; warnings explicitly identify this limitation. No generic URL fetch, hosted model agent, existing-run reader or report writer is exposed.

Raw artifacts and reports are not persisted. Evidence is self-contained; clients retain it in their conversations. Raw-artifact pointers are removed because there is no durable artifact store on this path. Research guidance distinguishes snapshots from growth, badge awards from unique users, and estimated server counts from measured counts. It forbids numerical breakout probabilities. A client's self-review is not represented as an independent Cronoblox critic run.

## Installation

- **Claude:** download the plugin ZIP from the card, then upload it through Customize → Plugins, review/enable the connector and start a conversation. If plugin upload is unavailable, add a custom connector using the MCP URL and use the starter prompt or downloadable skill. Paid-plan/workspace permissions may apply. Claude Code can use the extracted plugin via `claude --plugin-dir ./cronoblox`.
- **ChatGPT web:** enable Developer mode if the account permits it, open Plugins, add a custom connection with the MCP URL and no authentication, enable it in a chat and paste the starter prompt. Connecting MCP alone does **not** install a skill; the starter prompt and server instructions supply the workflow in this mode.
- **ChatGPT desktop / Codex:** download the OpenAI ZIP, extract it into `cronoblox-plugin`, run `codex plugin marketplace add ./cronoblox-plugin`, restart the app, then select/install Cronoblox from the local marketplace. The archive includes both skill and connection.
- **Other clients:** configure a remote HTTP MCP server and optionally install the skill. Supported MCP clients can also read `cronoblox://skills/investigate-roblox` or request the `investigate-roblox` prompt with `game_url`.

These are custom installations, **not approved public directory listings**. A landing-page button cannot silently install into another service. Public distribution still requires submitting to each provider and completing review. The UI never claims installation succeeded, invents an installation deep link, or requests AI subscription credentials.

Official references checked for this implementation: [OpenAI plugin testing](https://developers.openai.com/plugins/deploy/connect-chatgpt), [OpenAI publishing](https://developers.openai.com/plugins/deploy/submission), [OpenAI packaging](https://developers.openai.com/plugins/build/plugins), and [Claude plugins](https://support.claude.com/en/articles/13837440-use-plugins-in-claude). Client menus and plan availability can change.

## Hackathon safeguards and limits

- Request body: 32 KiB; body read timeout: 5 seconds; strict, length-bounded arguments.
- Up to four concurrent provider operations and 120 tool calls per minute **per process**. Identical concurrent calls share work.
- Provider requests receive cancellation after 25 seconds. Adapters may take a short additional period to unwind retries; the HTTP route allows 60 seconds.
- Public queries/results can be cached in process memory for 60 seconds, with at most 128 entries of 64 KiB each. No user identity or credentials are required or retained by the MCP implementation. Infrastructure logging is controlled separately by the host.
- Origin checks reject untrusted browser origins. Provider URLs are fixed Roblox endpoints or a YouTube search; arbitrary URL fetching is not exposed. Subprocess errors are sanitized.

These limits are not authentication or durable global quotas. Replicas have independent caches and limits. Add ingress-level abuse controls if traffic grows, and disable/remove the public endpoint after the event; there is no hard-coded retirement date. For a longer-lived launch, add auth, shared quotas, tenant-aware storage before saving user results, a privacy policy and operational monitoring. The existing unauthenticated run API is outside this integration and should not be substituted for it.

## Verification

`pnpm test` exercises the official MCP client/server protocol, tool validation, provider isolation, cache/coalescing, concurrency, cancellation, error sanitization and ZIP integrity. `pnpm test:e2e` checks actual downloads, keyboard/focus behavior, mobile layout, clipboard fallback and that this flow never starts a paid run.

Use `NEXT_BUILD_DIR=.next-verify pnpm build` to verify production output alongside an existing development server without replacing `.next`. For a live MCP protocol check, connect MCP Inspector to the running app's `/mcp` endpoint. A successful localhost check does not verify a user's cloud-client permissions or public networking.
