# Evaluation — simple baseline vs. Cronoblox agent

Generated: 2026-08-31T16:14:06.827Z · 10 frozen cases · every number computed from persisted run records by `pnpm evaluate`, read back through the deployed instance’s public API at <https://cronoblox.duckdns.org>.

**Primary metric.** Independent corroboration behind the verdict — the number of distinct external sources a reader can open to check the report, rather than taking the game's own page at its word.

**What a good result looks like.** For the intended user, a good final result is a verdict they could defend in a meeting: it rests on sources outside the game's own listing, it states the downside case explicitly, and it has survived a verification pass that was allowed to lower it. Claim traceability alone is not enough — a report can be perfectly traceable and still cite nothing but the page it was handed.

**Protocol.** Each case is run twice within the same hour: once on the `baseline` profile and once on `full`, both at effort=medium, user_mode=developer. Failures are preserved, never re-rolled.

**Fairness note.** Baseline receives the same mandatory Roblox data bundle and the same model, then makes one direct assessment call with no sub-agents and no verification. Full additionally receives delegation to the data and social agents and up to two critic revision cycles. Both share one run-wide budget cap.

## Headline comparison

| Metric | Simple baseline | Agent solution | Change |
| --- | ---: | ---: | ---: |
| **Independent sources behind the verdict** (primary) | 1.0 | 38.6 | **39×** |
| Evidence records per report | 5.0 | 55.7 | +50.7 |
| Claims traceable to a source | 90.3% | 100.0% | +9.7 pts † |
| Downside claims per report | 1.2 | 2.9 | +1.7 |
| Objections raised by verification | 0 | 26 | +26 |
| Ratings lowered after verification | 0 — structurally impossible | 4 / 10 | — |
| Runs degraded to a labeled unverified draft | n/a | 1 / 10 | — |
| Human time per task | ~30-45 min manual | 1m49s unattended | — |
| Runtime per task | 10.5s | 1m49s | +98.8s |
| Cost per task | $0.0003 | $0.0044 | +0.0041 |

† **Read this row together with the two above it — the shortfall is worse than the percentage suggests.**
The baseline does not simply cite fewer sources. In **4 of 10 runs it stated no downside case at all**,
and in 2 of those it produced **no claims whatsoever** while still emitting a rating: `Steal An Egg`
came back **HIGH with nothing behind it**, `Fallen Survival` MODERATE with nothing behind it. A
percentage computed over "the claims it did make" flatters a report that made none. Where the baseline
does cite, it is traceable only to the single bundle it was handed — the game's own Roblox listing — so
even its sourced claims are self-referential. The agent reaches 100% traceability across 38.6
independent sources and states a downside case in 10 of 10 runs. The gap is coverage, independence,
and willingness to argue against itself, not one number.

## Per-case results

| Case | Role | Sources (base → full) | Traceable claims | Downside claims | Objections | Rating (initial → final) | Verification |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Terminal [Escape Room] | escape-room niche, low-visit control | 1 → 30 | 100% → 100% | 0 → 4 | 4 | MODERATE → MODERATE | completed |
| Build a Gun Army | trend-chasing "build a" clone | 1 → 43 | 57% → 100% | 3 → 3 | 0 | MODERATE → MODERATE | completed |
| **Merge a Spinner!** ⚠️ | HARD CASE: update spike vs durability | 1 → 36 | 100% → 100% | 2 → 3 | 3 | MODERATE → MODERATE | completed |
| Jump To Steal Soccer Players | "steal" genre trend follower | 1 → 32 | 100% → 100% | 1 → 3 | 4 | HIGH → MODERATE | completed |
| +1 Cut Grass Adventure | incremental/idle trend follower | 1 → 39 | 100% → 100% | 3 → 2 | 3 | MODERATE → MODERATE | completed |
| Clean all the leaves! | simulator trend follower | 1 → 59 | 100% → 100% | 2 → 4 | 0 | HIGH → MODERATE | completed |
| Rogue Lineage | legacy durable niche control | 1 → 38 | 100% → 100% | 1 → 3 | 3 | LOW → LOW | completed |
| Debt Hunt | recent horror/co-op release | 1 → 26 | 100% → 100% | 0 → 3 | 4 | MODERATE → LOW | completed |
| Fallen Survival | mid-age survival control | 1 → 56 | — → 100% | 0 → 1 | 2 | HIGH → LOW | incomplete |
| Steal An Egg | breakout-adjacent "steal" genre | 1 → 27 | — → 100% | 0 → 3 | 3 | VERY HIGH → VERY HIGH | completed |

## The hard case

**Merge a Spinner!** is the frozen hard case: a game carrying an `[UPD 2]` tag and ~6,000 concurrent players, where the entire question is whether that is durable interest or an update spike. It is also the game that repeatedly broke the system during development — two earlier live runs failed at the critic (`59caef44-3216-42be-afc7-aacbd590e3dd`), which is what produced the per-turn deadline and the unverified-draft degradation path.

In this sweep the baseline rated it MODERATE from a single source. The agent gathered **36 independent sources**, arrived at MODERATE as well — and then the critic raised three objections that are the real result here:

1. **A number that was right but not checkable.** The 92.1% like ratio was derived from records (`ev_6e06d999`, `ev_ff62196a`, `ev_364f526`) that contain no up-vote or down-vote values, so the ratio's provenance could not be verified from the evidence actually cited. The critic also caught the claim splicing that ratio onto a *lifetime* visit count as if the two described the same population.
2. **An overclaim from near-zero evidence.** "Genuinely diverse across regions and content types" rested on two videos with **2 views and 635 views**. The videos are real; the conclusion is not available from them.
3. **A halo that belongs to other games.** The YouTube attention supporting the thesis demonstrably feeds *adjacent* merge titles rather than this one. The critic confirmed the report had labeled this correctly as a transfer risk rather than misattributing it — and held the rating at MODERATE partly because of it.

**What it revealed:** the failure mode that survives an evidence gate is not fabrication. Every claim above cited a real, persisted record, and the gate passed all of them — correctly, because the records existed. What the gate cannot check is whether a record *supports* the sentence attached to it. Existence is mechanical; support is a judgement. That is the entire job of the critic, and it is why the verification pass earns its cost.

Note that the critic **held** MODERATE rather than lowering it. The objections concerned the quality of support, not the conclusion, and it said so. A verifier that downgrades everything it touches is as useless as one that never does — in this sweep it lowered 4 of 10 ratings and held the rest.

## Run identifiers

**Every run below is live and clickable.** These are the exact runs behind every number in this report, on the deployed instance at <https://cronoblox.duckdns.org> — open any report, or its full agent trajectory, and audit the figures yourself. Regenerate the whole table from scratch with `pnpm evaluate:sweep && pnpm evaluate --remote https://cronoblox.duckdns.org`.

Five traces from these exact runs are also committed under `trajectories/` so they can be read with no
instance at all.

| Case | Baseline run | Full run |
| --- | --- | --- |
| Terminal [Escape Room] | [report](https://cronoblox.duckdns.org/runs/4690be85-0881-41ac-adc1-b808ea013465) · [trajectory](https://cronoblox.duckdns.org/runs/4690be85-0881-41ac-adc1-b808ea013465?view=trajectory)<br>`4690be85-0881-41ac-adc1-b808ea013465` | [report](https://cronoblox.duckdns.org/runs/908d7cd2-129b-4c68-a444-c4fbb200ef06) · [trajectory](https://cronoblox.duckdns.org/runs/908d7cd2-129b-4c68-a444-c4fbb200ef06?view=trajectory)<br>`908d7cd2-129b-4c68-a444-c4fbb200ef06` |
| Build a Gun Army | [report](https://cronoblox.duckdns.org/runs/e79dc7d2-35ef-4f66-b94c-dec669adb6b0) · [trajectory](https://cronoblox.duckdns.org/runs/e79dc7d2-35ef-4f66-b94c-dec669adb6b0?view=trajectory)<br>`e79dc7d2-35ef-4f66-b94c-dec669adb6b0` | [report](https://cronoblox.duckdns.org/runs/da152c5d-2d4b-4b3a-a1d9-76ea3924acfd) · [trajectory](https://cronoblox.duckdns.org/runs/da152c5d-2d4b-4b3a-a1d9-76ea3924acfd?view=trajectory)<br>`da152c5d-2d4b-4b3a-a1d9-76ea3924acfd` |
| Merge a Spinner! | [report](https://cronoblox.duckdns.org/runs/afc24d45-31b7-4285-91f8-05d1d1de6d01) · [trajectory](https://cronoblox.duckdns.org/runs/afc24d45-31b7-4285-91f8-05d1d1de6d01?view=trajectory)<br>`afc24d45-31b7-4285-91f8-05d1d1de6d01` | [report](https://cronoblox.duckdns.org/runs/386fc820-e20d-4a35-8b64-ab84c2104a72) · [trajectory](https://cronoblox.duckdns.org/runs/386fc820-e20d-4a35-8b64-ab84c2104a72?view=trajectory)<br>`386fc820-e20d-4a35-8b64-ab84c2104a72` |
| Jump To Steal Soccer Players | [report](https://cronoblox.duckdns.org/runs/bc1b29df-0065-4263-998a-321089a7dac4) · [trajectory](https://cronoblox.duckdns.org/runs/bc1b29df-0065-4263-998a-321089a7dac4?view=trajectory)<br>`bc1b29df-0065-4263-998a-321089a7dac4` | [report](https://cronoblox.duckdns.org/runs/c8497f0d-5221-47f5-bea4-26281f39e2bf) · [trajectory](https://cronoblox.duckdns.org/runs/c8497f0d-5221-47f5-bea4-26281f39e2bf?view=trajectory)<br>`c8497f0d-5221-47f5-bea4-26281f39e2bf` |
| +1 Cut Grass Adventure | [report](https://cronoblox.duckdns.org/runs/095258c2-b31e-4afe-b414-d3295495be1a) · [trajectory](https://cronoblox.duckdns.org/runs/095258c2-b31e-4afe-b414-d3295495be1a?view=trajectory)<br>`095258c2-b31e-4afe-b414-d3295495be1a` | [report](https://cronoblox.duckdns.org/runs/92380e97-dfce-413b-b111-848bebad1a88) · [trajectory](https://cronoblox.duckdns.org/runs/92380e97-dfce-413b-b111-848bebad1a88?view=trajectory)<br>`92380e97-dfce-413b-b111-848bebad1a88` |
| Clean all the leaves! | [report](https://cronoblox.duckdns.org/runs/a77697e2-707b-4d6e-a827-eadf761c7efd) · [trajectory](https://cronoblox.duckdns.org/runs/a77697e2-707b-4d6e-a827-eadf761c7efd?view=trajectory)<br>`a77697e2-707b-4d6e-a827-eadf761c7efd` | [report](https://cronoblox.duckdns.org/runs/37f9cc67-33c7-40af-975c-2d59dbe472bb) · [trajectory](https://cronoblox.duckdns.org/runs/37f9cc67-33c7-40af-975c-2d59dbe472bb?view=trajectory)<br>`37f9cc67-33c7-40af-975c-2d59dbe472bb` |
| Rogue Lineage | [report](https://cronoblox.duckdns.org/runs/03bf3c96-0f56-4e7b-98e6-4dea6ba633d6) · [trajectory](https://cronoblox.duckdns.org/runs/03bf3c96-0f56-4e7b-98e6-4dea6ba633d6?view=trajectory)<br>`03bf3c96-0f56-4e7b-98e6-4dea6ba633d6` | [report](https://cronoblox.duckdns.org/runs/85faa28a-903a-4a60-bebf-c769f4714cfe) · [trajectory](https://cronoblox.duckdns.org/runs/85faa28a-903a-4a60-bebf-c769f4714cfe?view=trajectory)<br>`85faa28a-903a-4a60-bebf-c769f4714cfe` |
| Debt Hunt | [report](https://cronoblox.duckdns.org/runs/c4a2a873-d97d-49d6-851a-ed1d4b5dc242) · [trajectory](https://cronoblox.duckdns.org/runs/c4a2a873-d97d-49d6-851a-ed1d4b5dc242?view=trajectory)<br>`c4a2a873-d97d-49d6-851a-ed1d4b5dc242` | [report](https://cronoblox.duckdns.org/runs/92137d8d-99ca-4b6f-b67e-3c89a77fde27) · [trajectory](https://cronoblox.duckdns.org/runs/92137d8d-99ca-4b6f-b67e-3c89a77fde27?view=trajectory)<br>`92137d8d-99ca-4b6f-b67e-3c89a77fde27` |
| Fallen Survival | [report](https://cronoblox.duckdns.org/runs/cb85a0f8-daf3-4e74-8a12-3b49c232a8e2) · [trajectory](https://cronoblox.duckdns.org/runs/cb85a0f8-daf3-4e74-8a12-3b49c232a8e2?view=trajectory)<br>`cb85a0f8-daf3-4e74-8a12-3b49c232a8e2` | [report](https://cronoblox.duckdns.org/runs/173bdc54-e15e-49a6-bd07-7c9adc00c0eb) · [trajectory](https://cronoblox.duckdns.org/runs/173bdc54-e15e-49a6-bd07-7c9adc00c0eb?view=trajectory)<br>`173bdc54-e15e-49a6-bd07-7c9adc00c0eb` |
| Steal An Egg | [report](https://cronoblox.duckdns.org/runs/8e72b91a-ddd0-4563-9604-fff37d0c9be9) · [trajectory](https://cronoblox.duckdns.org/runs/8e72b91a-ddd0-4563-9604-fff37d0c9be9?view=trajectory)<br>`8e72b91a-ddd0-4563-9604-fff37d0c9be9` | [report](https://cronoblox.duckdns.org/runs/cb2c0733-a097-44a5-b7ec-4ed3b144b9ba) · [trajectory](https://cronoblox.duckdns.org/runs/cb2c0733-a097-44a5-b7ec-4ed3b144b9ba?view=trajectory)<br>`cb2c0733-a097-44a5-b7ec-4ed3b144b9ba` |

## Case selection

Ten live public Roblox experiences taken from Roblox discovery surfaces during the hackathon window. They are deliberately mid- and small-scale games whose outcome is still undecided — the situation the tool exists for — rather than already-decided giants like Adopt Me. IDs were frozen before the paired sweep was run, and both profiles receive the identical URL, effort and user mode.
