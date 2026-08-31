import { expect, test } from "@playwright/test";

const evidence = { id: "ev_e2e", run_id: "e2e-run", module_id: "roblox-data", kind: "fact", claim: "The game had 3,821 concurrent players when observed.", source: { type: "fixture", url: "https://games.roblox.com/v1/games?universeIds=2", retrieved_at: "2026-08-29T12:00:00.000Z", cache_key: "fixture" }, observation: { value: 3821, unit: "concurrent_players", raw_ref: "raw/core.json" }, derivation: null, support_strength: "high", relationship: "supports", related_claim_ids: [], notes: "Cached test evidence", used_by: ["orchestrator", "critic", "report"] };
const run = { id: "e2e-run", input: { game_url: "8737899170", user_mode: "developer", profile_id: "demo-replay", optional_modules: ["market-intelligence", "critic"] }, state: "COLLECT_CORE", game_name: "Build A Boat Odyssey", universe_id: "2", profile_snapshot: { id: "demo-replay", version: 1, label: "Demo replay", description: "Cached fixture", enabled_modules: ["roblox-data", "market-intelligence", "critic"], enabled_tools: ["fixture"], module_versions: { "roblox-data": "1.0.0", "market-intelligence": "1.0.0", critic: "1.0.0" }, model: "fixture", limits: { max_iterations: 8, max_runtime_ms: 240000, max_external_calls: 18, max_critic_cycles: 2, max_cost_usd: 1.5 }, search: { locale: "en-US", country: "US", device: "desktop" }, fixture_mode: true }, error: null, created_at: "2026-08-29T12:00:00.000Z", updated_at: "2026-08-29T12:00:01.000Z" };
const report = { run_id: "e2e-run", game: { name: "Build A Boat Odyssey", place_id: "8737899170", universe_id: "2", creator: "Odyssey Works", creator_id: "101", creator_type: "Group", url: "https://www.roblox.com/games/8737899170", creator_url: "https://www.roblox.com/communities/101", observed_at: "2026-08-29T12:00:00.000Z", icon_url: null, thumbnail_url: null, thumbnails: [] }, user_mode: "developer", verdict: { breakout_potential: "HIGH", verdict_line: "Strong live engagement, but durability past the update window is unproven.", recommendation: "Watch persistence after the update window." }, initial_verdict: { breakout_potential: "VERY HIGH" }, audit_cards: [{ module_id: "roblox-data", label: "Roblox data", status: "completed", summary: "3,821 playing · 93.8% likes", evidence_ids: ["ev_e2e"], warnings: [] }, { module_id: "market-intelligence", label: "Market & social", status: "completed", summary: "Creator diversity reviewed.", evidence_ids: [], warnings: [] }, { module_id: "critic", label: "Verification", status: "completed", summary: "Durability constrained the rating.", evidence_ids: ["ev_e2e"], warnings: [] }], supporting_claims: [{ id: "c1", text: "Live engagement and approval are promising.", evidence_ids: ["ev_e2e"] }], risk_claims: [{ id: "c2", text: "Persistence is not established by one snapshot.", evidence_ids: ["ev_e2e"] }], critic: { changed_assessment: true, summary: "The rating fell one step because durability is unproven.", objections: [{ id: "o1", severity: "medium", summary: "One snapshot cannot prove persistence.", affected_claim_ids: ["c1"], evidence_ids: ["ev_e2e"], resolution_request: "Lower the rating and monitor persistence.", resolved: true }] }, next_action: "Watch persistence after the update window.", monitor: ["Concurrent-player persistence"], limitations: ["Cached fixture report"], source_failures: [], runtime_ms: 850, approximate_cost_usd: 0, evidence_ids: ["ev_e2e"], is_fixture: true };

test("home exposes the core submission flow", async ({ page }) => {
  await page.route("**/api/runs", async (route) => route.request().method() === "GET" ? route.fulfill({ json: { runs: [] } }) : route.continue());
  await page.goto("/"); await expect(page.getByRole("heading", { name: /Find the signal/ })).toBeVisible(); await expect(page.getByLabel("ROBLOX GAME URL OR EXPERIENCE ID")).toBeVisible(); await expect(page.getByRole("button", { name: /RUN THE AUDIT/ })).toBeVisible();
});

test("submits, follows visible progress, opens report and evidence", async ({ page }) => {
  let detailReads = 0;
  await page.route("**/api/runs", async (route) => route.request().method() === "POST" ? route.fulfill({ status: 201, json: { run_id: "e2e-run", state: "QUEUED" } }) : route.fulfill({ json: { runs: [] } }));
  await page.route("**/api/runs/e2e-run/evidence", async (route) => route.fulfill({ json: { evidence: [evidence] } }));
  await page.route("**/api/runs/e2e-run", async (route) => { detailReads += 1; await route.fulfill({ json: detailReads === 1 ? { run, events: [{ id: "event-1", run_id: "e2e-run", sequence: 0, state: "COLLECT_CORE", level: "info", event_type: "state.collect_core", message: "Resolving game identity and collecting current Roblox evidence", data: {}, created_at: "2026-08-29T12:00:00.000Z" }], report: null } : { run: { ...run, state: "COMPLETED" }, events: [], report } }); });
  await page.goto("/"); await page.getByLabel("ROBLOX GAME URL OR EXPERIENCE ID").fill("8737899170"); await page.getByLabel("ANALYSIS PROFILE").selectOption("demo-replay"); await page.getByRole("button", { name: /RUN THE AUDIT/ }).click();
  await expect(page).toHaveURL(/\/runs\/e2e-run/); await expect(page.getByText("VISIBLE TRAJECTORY")).toBeVisible(); await expect(page.getByText("Resolving game identity and collecting current Roblox evidence")).toBeVisible();
  await expect(page.getByText("BREAKOUT POTENTIAL")).toBeVisible({ timeout: 5000 }); await expect(page.getByText("HIGH", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Roblox data/ }).click(); await expect(page.getByText("EVIDENCE WORKSPACE")).toBeVisible(); await expect(page.getByText(/3,821 concurrent players/)).toBeVisible();
});

test("failed run elapsed time stays pinned to when it finished, including after reload", async ({ page }) => {
  await page.route("**/api/runs/e2e-run", (route) => route.fulfill({ json: { run: { ...run, state: "FAILED", updated_at: "2026-08-29T12:08:26.000Z", error: "Model timed out after 90s on turn 2." }, events: [], report: null } }));
  await page.goto("/runs/e2e-run");
  await expect(page.getByLabel("Elapsed time 08:26")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Elapsed time 08:26")).toBeVisible();
});

test("an incomplete critic review is never presented as successful verification", async ({ page }) => {
  await page.route("**/api/runs/e2e-run", (route) => route.fulfill({ json: { run: { ...run, state: "COMPLETED" }, events: [], report: { ...report, critic: { ...report.critic, verification_status: "incomplete", summary: "Independent verification timed out." } } } }));
  await page.goto("/runs/e2e-run");
  await expect(page.getByText(/UNVERIFIED RESEARCH DRAFT/)).toBeVisible();
  await expect(page.getByText("Verification incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVERIFIED RATING", { exact: true })).toBeVisible();
  await expect(page.getByText(/Rating survived verification|Rating lowered after verification/)).toHaveCount(0);
});

test("a completed run can still show the agent trajectory, including via a deep link", async ({ page }) => {
  const events = [
    { id: "ev-1", run_id: "e2e-run", sequence: 0, state: "EXECUTE", level: "info", event_type: "orchestrator.llm_result", message: "orchestrator's model replied in 4.0s (turn 1)", data: { iteration: 1, duration_ms: 3985, prompt_tokens: 2152, completion_tokens: 460 }, created_at: "2026-08-29T12:00:04.000Z" },
    { id: "ev-2", run_id: "e2e-run", sequence: 1, state: "EXECUTE", level: "info", event_type: "data-agent.tool_call", message: "data-agent called roblox_search_peers — merge tycoon", data: { tool: "roblox_search_peers", args: { query: "merge tycoon" }, detail: "merge tycoon" }, created_at: "2026-08-29T12:00:05.000Z" },
  ];
  await page.route("**/api/runs/e2e-run", (route) => route.fulfill({ json: { run: { ...run, state: "COMPLETED" }, events, report } }));

  // The report is the default view, and the trajectory must remain reachable from it.
  await page.goto("/runs/e2e-run");
  await expect(page.getByText("BREAKOUT POTENTIAL")).toBeVisible();
  await page.getByRole("tab", { name: /AGENT TRAJECTORY/ }).click();
  await expect(page.getByText("FULL AGENT TRAJECTORY")).toBeVisible();
  await expect(page.getByText("data-agent called roblox_search_peers — merge tycoon")).toBeVisible();
  await expect(page.getByText('{"query":"merge tycoon"}')).toBeVisible();
  await expect(page).toHaveURL(/view=trajectory/);

  // A judge handed only the deep link lands on the trace directly.
  await page.goto("/runs/e2e-run?view=trajectory");
  await expect(page.getByText("FULL AGENT TRAJECTORY")).toBeVisible();
  await expect(page.getByRole("tab", { name: /AGENT TRAJECTORY/ })).toHaveAttribute("aria-selected", "true");
});
