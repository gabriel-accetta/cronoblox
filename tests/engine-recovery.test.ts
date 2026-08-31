import { afterEach, describe, expect, it, vi } from "vitest";
import { getProfile } from "@cronoblox/config";
import type { Evidence, Report } from "@cronoblox/contracts";
import * as db from "../packages/db/src/index";
import { executeRun } from "@cronoblox/engine";
import { criticModule } from "@cronoblox/module-critic";

const mockDb = vi.hoisted(() => ({ getRunRow: vi.fn(), addRunEvent: vi.fn(), updateRunState: vi.fn(), appendEvidence: vi.fn(), listRunEvidence: vi.fn(), listRunModules: vi.fn(), saveModuleResult: vi.fn(), saveRawArtifact: vi.fn(), saveReport: vi.fn() }));
vi.mock("../packages/db/src/index", () => mockDb);

describe("engine preserves research when optional verification fails", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("persists a visibly unverified report, no verified event and no further revision calls", async () => {
    const evidence: Evidence[] = [];
    const rows: db.RunModuleRow[] = [];
    const runId = "11111111-1111-1111-1111-111111111111";
    vi.mocked(db.getRunRow).mockResolvedValue({ id: runId, state: "QUEUED", cancelledAt: null, profileSnapshot: getProfile("demo-replay"), input: { game_url: "8737899170", user_mode: "developer", profile_id: "demo-replay", optional_modules: ["critic"] } } as Awaited<ReturnType<typeof db.getRunRow>>);
    vi.mocked(db.appendEvidence).mockImplementation(async (_id, items) => { evidence.push(...items); });
    vi.mocked(db.listRunEvidence).mockImplementation(async () => evidence);
    vi.mocked(db.saveModuleResult).mockImplementation(async (_id, moduleId, _version, result) => { rows.push({ moduleId, status: result.status, output: result.output, warnings: result.warnings }); });
    vi.mocked(db.listRunModules).mockImplementation(async () => rows);
    const critic = vi.spyOn(criticModule, "execute").mockImplementation(async (input) => ({ status: "failed", output: { summary: "Independent verification timed out; thesis remains unverified.", objections: [], recommended_potential: input.thesis.breakout_potential }, evidence: [], warnings: ["Critic timed out."], suggested_next_steps: [], metrics: { duration_ms: 90_000, external_calls: 0, estimated_cost_usd: null } }));

    await executeRun(runId);

    expect(critic).toHaveBeenCalledTimes(1);
    expect(rows.find((row) => row.moduleId === "critic")?.status).toBe("failed");
    expect(db.updateRunState).toHaveBeenCalledWith(runId, "COMPLETED", { completed: true });
    const report = vi.mocked(db.saveReport).mock.calls[0]?.[1] as Report;
    expect(report.critic.verification_status).toBe("incomplete");
    expect(report.verdict.breakout_potential).toBe(report.initial_verdict.breakout_potential);
    expect(report.source_failures).toContain("Critic timed out.");
    expect(report.supporting_claims.length).toBeGreaterThan(0);
    expect(report.supporting_claims.flatMap((claim) => claim.evidence_ids).every((id) => evidence.some((item) => item.id === id))).toBe(true);
    const types = vi.mocked(db.addRunEvent).mock.calls.map((call) => call[3]);
    expect(types).toContain("critic.incomplete");
    expect(types).not.toContain("critic.resolved");
    expect(types).not.toContain("critic.revise");
    expect(types).not.toContain("run.failed");
  });
});
