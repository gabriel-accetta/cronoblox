# Run latency and optional verification recovery

## Incident: Merge a Spinner, 2026-08-31

Original run: `59caef44-3216-42be-afc7-aacbd590e3dd` (Full, Medium, DeepSeek V4 Flash 0731).

The run failed at the critic with `This operation was aborted`, after an initial thesis and research evidence had already been persisted. The timeline places the failure roughly 95 seconds after the critic's evidence lookups, consistent with the agent loop's 90-second model-request deadline. The old loop did not persist normal model-call timings or the underlying abort cause, so the original provider latency cannot be reconstructed precisely.

Persisted module measurements (monotonic duration, not additive):

| Module | Duration | Observation |
| --- | ---: | --- |
| Roblox core | 2.4s | Finished normally. |
| Data agent | 65.3s | Six exploration calls; catalog searches returned empty results. |
| Social agent | 168.6s | Six source calls; model ignored a forced conclusion before finally submitting. |
| Orchestrator, including both delegates | 335.1s | Thesis was successfully stored. |
| Critic | No completed measurement | Requested 13 stored records in one batch, then aborted during the next model request. |

Source artifacts show YouTube searches generally returned in about 1–2 seconds. The 13 critic lookups together took approximately 60ms. Long gaps around those events were model waits, not slow database evidence lookup. Wall-clock creation-to-failure was 8m26s; reopening a failed run previously continued counting elapsed time until the page loaded.

OpenRouter's [model catalog](https://openrouter.ai/api/v1/models) advertises DeepSeek V4 Flash 0731's default reasoning as **high**, with low/high/max supported. Before this fix, Cronoblox effort scaled research allowances but did not set model reasoning. See also the provider's [reasoning configuration documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Current behavior

- New version-2 profiles explicitly snapshot low reasoning for Low/Medium DeepSeek V4 runs, and high reasoning for High. Unknown models keep provider defaults; legacy snapshots are not rewritten.
- Each model turn has a 90-second deadline covering headers and response-body reading, a 4,096-token output cap (including reasoning), and SDK retries disabled per request. Visible events record starts, completions, failures, durations, and token counts—never private reasoning text.
- A model ignoring forced tool submission goes directly to one schema-validated JSON recovery request, capped at 45 seconds. Recovery starts a clean terminal request containing the gathered observations and schema, without reissuing tools or replaying private reasoning. Invalid final tool arguments get at most one correction. Failed external tool attempts also consume allowance.
- The critic receives the full stored records cited by the thesis upfront. Additional evidence lookup and spot-check tools remain available.
- An individual critic timeout, transient provider failure, or exhausted structured-response recovery persists the critic as failed through `ModuleRunner`. The engine keeps the research and emits an **unverified draft**, including warnings and `critic.verification_status: "incomplete"`. It does not invent a critique, claim verification succeeded, or start revision calls because verification was unavailable.
- Run-wide aborts, authentication/configuration errors, and programming/schema errors are not swallowed by this optional-provider recovery path. Required research must still produce a valid thesis before a report can be built.
- Finished-run timers use the persisted terminal timestamp, including after reload.
- Source spot-checks accept JSON API responses as readable text, without parsing their contents as HTML. The final live replay exposed this separate issue when the critic tried to verify a Roblox API citation.

Regression coverage: `agent-timeouts.test.ts`, `agent-budget.test.ts`, `critic-recovery.test.ts`, `engine-recovery.test.ts`, and the failed-run/incomplete-review cases in `e2e/home.spec.ts`.

## Live verification

- `bc1df3eb-84c9-4cb4-8905-92e8e91a7010`: first replay sped up social research to 36.9s, but the orchestrator timed out and its original 30s recovery also timed out. This prompted the output cap and clean terminal recovery request. A separate synthesis-only diagnostic using the saved evidence then completed in 35.4s (reported model cost $0.000707), supporting a 45s recovery allowance.
- `ee7e1c3d-3a08-4e7a-b528-8c87a4de60f4`: subsequent full live replay produced an evidence-linked **unverified draft** in 283,037ms (4m43s), with reported model cost $0.003566. Data research took 35.2s, social research 53.0s, and orchestrator including delegates 116.9s. Its final synthesis response took 24.2s without recovery. The critic's second model request still timed out after 90s; this correctly became an explicit incomplete-verification warning, not a failed run or a fabricated verification result. The original failed run was left unchanged.

These are individual measurements, not a latency guarantee. This model/provider's verification reliability remains unresolved. Reported cost comes from received usage responses and may omit provider-side charges for timed-out requests. The JSON-reader patch was made after this replay and separately verified with a live Roblox API read and deterministic tests.
