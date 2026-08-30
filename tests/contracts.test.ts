import { describe, expect, it } from "vitest";
import { EvidenceSchema, ReportSchema, assertReportEvidence } from "@cronoblox/contracts";
import { createEvidence, deriveEvidence, validateAppendOnly } from "@cronoblox/evidence";

const fact = createEvidence({ run_id: "11111111-1111-1111-1111-111111111111", module_id: "roblox-data", kind: "fact", claim: "Observed 100 players.", source: { type: "fixture", url: null, retrieved_at: "2026-08-29T12:00:00.000Z", cache_key: "x" }, observation: { value: 100, unit: "players", raw_ref: "raw/x.json" }, derivation: null, support_strength: "high", relationship: "supports", related_claim_ids: [], notes: null, used_by: ["orchestrator", "report"] });

describe("evidence workspace", () => {
  it("validates canonical evidence", () => expect(EvidenceSchema.parse(fact).id).toBe(fact.id));
  it("requires source evidence for derived claims", () => expect(() => deriveEvidence({ runId: fact.run_id, moduleId: "x", claim: "Derived", value: 1, unit: null, method: "test", from: [] })).toThrow());
  it("is append-only", () => expect(() => validateAppendOnly([fact], [fact])).toThrow(/already exists/));
});

describe("report evidence integrity", () => {
  it("rejects missing evidence references", () => {
    const report = ReportSchema.parse({ run_id: fact.run_id, game: { name: "Game", place_id: "1", universe_id: "2", creator: "Creator", creator_id: "9", creator_type: "User", url: "https://www.roblox.com/games/1", creator_url: "https://www.roblox.com/users/9/profile", observed_at: "2026-08-29T12:00:00.000Z", icon_url: null, thumbnail_url: null, thumbnails: [] }, user_mode: "developer", verdict: { breakout_potential: "MODERATE", verdict_line: "Solid engagement, unproven durability.", recommendation: "Watch" }, initial_verdict: { breakout_potential: "MODERATE" }, audit_cards: [], supporting_claims: [{ id: "c1", text: "Claim", evidence_ids: ["missing"] }], risk_claims: [], critic: { changed_assessment: false, summary: "None", objections: [] }, next_action: "Watch", monitor: [], limitations: [], source_failures: [], runtime_ms: 1, approximate_cost_usd: 0, evidence_ids: [], is_fixture: true });
    expect(() => assertReportEvidence(report, [fact])).toThrow(/missing evidence/);
  });
});
