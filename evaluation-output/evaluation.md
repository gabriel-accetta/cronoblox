# Evaluation — simple baseline vs. Cronoblox agent

Generated: 2026-08-31T15:34:05.217Z · 10 frozen cases · every number computed from persisted run records by `pnpm evaluate`.

**Primary metric.** Independent corroboration behind the verdict — the number of distinct external sources a reader can open to check the report, rather than taking the game's own page at its word.

**What a good result looks like.** For the intended user, a good final result is a verdict they could defend in a meeting: it rests on sources outside the game's own listing, it states the downside case explicitly, and it has survived a verification pass that was allowed to lower it. Claim traceability alone is not enough — a report can be perfectly traceable and still cite nothing but the page it was handed.

**Protocol.** Each case is run twice within the same hour: once on the `baseline` profile and once on `full`, both at effort=medium, user_mode=developer. Failures are preserved, never re-rolled.

**Fairness note.** Baseline receives the same mandatory Roblox data bundle and the same model, then makes one direct assessment call with no sub-agents and no verification. Full additionally receives delegation to the data and social agents and up to two critic revision cycles. Both share one run-wide budget cap.

## Headline comparison

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

## Per-case results

| Case | Role | Sources (base → full) | Traceable claims | Downside claims | Objections | Rating (initial → final) | Verification |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Terminal [Escape Room] | escape-room niche, low-visit control | 1 → 31 | 100% → 88% | 3 → 3 | 2 | MODERATE → MODERATE | completed |
| Build a Gun Army | trend-chasing "build a" clone | 1 → 26 | 100% → 100% | 2 → 4 | 4 | MODERATE → LOW | completed |
| **Merge a Spinner!** ⚠️ | HARD CASE: update spike vs durability | 1 → 38 | 100% → 100% | 2 → 3 | 4 | MODERATE → MODERATE | completed |
| Jump To Steal Soccer Players | "steal" genre trend follower | 1 → 27 | 100% → 100% | 2 → 4 | 2 | MODERATE → MODERATE | completed |
| +1 Cut Grass Adventure | incremental/idle trend follower | 1 → 26 | 100% → 100% | 3 → 4 | 0 | MODERATE → MODERATE | incomplete |
| Clean all the leaves! | simulator trend follower | 1 → 30 | 100% → 86% | 3 → 3 | 4 | HIGH → MODERATE | completed |
| Rogue Lineage | legacy durable niche control | 1 → 39 | 88% → 100% | 4 → 3 | 3 | MODERATE → LOW | completed |
| Debt Hunt | recent horror/co-op release | 1 → 32 | 100% → 100% | 3 → 4 | 3 | MODERATE → MODERATE | completed |
| Fallen Survival | mid-age survival control | 1 → 38 | 86% → 100% | 3 → 3 | 3 | MODERATE → MODERATE | completed |
| Steal An Egg | breakout-adjacent "steal" genre | 1 → 19 | 86% → 100% | 3 → 3 | 3 | HIGH → MODERATE | completed |

## The hard case

**Merge a Spinner!** is the hard case: a game carrying an `[UPD 2]` tag and a 6.6K concurrent player base, where the whole question is whether that is durable interest or an update spike. It is also the case that repeatedly exposed real bugs during development — two earlier live runs on this game failed at the critic (`59caef44-3216-42be-afc7-aacbd590e3dd`), which is what produced the per-turn deadline and the unverified-draft degradation path.

In the evaluation sweep the baseline rated it MODERATE from one source. The agent gathered 38 independent sources, also arrived at MODERATE — and then the critic raised four objections that are the actual result here:

1. It found that the report's claim *"no top-tier influencer has covered this game"* was anchored to evidence documenting SSundee's 339K-view video about **a different game** (Merge a Tank). An absence cannot be proven by a record about something else. The critic let the rating stand but logged the claim as under-supported.
2. It flagged that a 92.1% like ratio was derived from records whose stored observations do not expose the underlying vote counts — the number was right, but its lineage was not independently checkable from the cited records alone.
3. It rejected *"self-sustaining player interest"* as an interpretive leap from four videos with 6 to 635 views.

**What it revealed:** the failure mode that survives an evidence gate is not fabrication — every one of those claims cited a real, persisted record. It is *misattribution*: a claim pointing at evidence that exists but does not actually support it. A gate can only check that a record exists; checking that it supports the claim is exactly the job the critic does, and it is why the verification pass earns its cost. Note also that the critic held MODERATE rather than lowering it, because the objections concerned support quality, not the conclusion — a verifier that lowers every rating it touches is as useless as one that never does.

## Run identifiers

These ids belong to the sweep instance that produced this table, not to the public demo — the hosted
app at <https://cronoblox.duckdns.org> keeps its own database. Open a row on whichever instance ran
it (`/runs/<id>`, or `/runs/<id>?view=trajectory` for the full agent trace), or regenerate the whole
table on your own machine with `pnpm evaluate:sweep && pnpm evaluate`. Four traces from these exact
runs are committed under `trajectories/` so they can be read with no instance at all.

| Case | Baseline run | Full run |
| --- | --- | --- |
| Terminal [Escape Room] | `43804553-8355-4d96-ba9a-b0f3f0d73d3c` (COMPLETED) | `aa52a2a1-7ab6-4dfd-afde-4380bbb0bcef` (COMPLETED) |
| Build a Gun Army | `66caeb96-f1eb-449e-8306-69e5a2ea10d0` (COMPLETED) | `108269d8-995e-487c-a4cd-e9e91202d48d` (COMPLETED) |
| Merge a Spinner! | `1d1c58e9-ba00-4155-acd5-54ab243d5a94` (COMPLETED) | `44805c7e-e129-4184-9771-234164477089` (COMPLETED) |
| Jump To Steal Soccer Players | `40363afa-e078-4f4d-b316-51a74bb1a487` (COMPLETED) | `42cbc7d6-5f59-44ff-b11d-79dd22b1d2d8` (COMPLETED) |
| +1 Cut Grass Adventure | `f5d659c9-636d-494e-8a82-cb57f2da21be` (COMPLETED) | `0072a746-2738-421e-9bc5-e35abaf17b2a` (COMPLETED) |
| Clean all the leaves! | `74ad7b42-ed18-4302-9c15-d440fe4b84ae` (COMPLETED) | `cd8ebd72-44d2-4b2e-b785-f3484bbf5223` (COMPLETED) |
| Rogue Lineage | `4d79c03b-98d6-4f66-9322-659051a0ad81` (COMPLETED) | `7c8db44e-5f55-4d84-85e8-339041c2d261` (COMPLETED) |
| Debt Hunt | `3a21ce00-2487-4a93-9fc4-a67442af8867` (COMPLETED) | `1ed6f05c-076a-451b-823e-33782e847e20` (COMPLETED) |
| Fallen Survival | `459bb2b2-7e2e-49e8-ba87-a8c704e0f9f1` (COMPLETED) | `271a5ced-ea8a-40ef-a346-709314cfe451` (COMPLETED) |
| Steal An Egg | `ecf47a92-7d44-48de-a580-b6be664beead` (COMPLETED) | `35a05426-8163-43f8-bed3-a71cef3d5f41` (COMPLETED) |

## Case selection

Ten live public Roblox experiences taken from Roblox discovery surfaces during the hackathon window. They are deliberately mid- and small-scale games whose outcome is still undecided — the situation the tool exists for — rather than already-decided giants like Adopt Me. IDs were frozen before the paired sweep was run, and both profiles receive the identical URL, effort and user mode.
