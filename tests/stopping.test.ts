import { describe, expect, it } from "vitest";
import { evaluateStoppingRule } from "@cronoblox/engine";

describe("bounded stopping rule", () => {
  it("continues for unresolved high-severity objections", () => expect(evaluateStoppingRule({ requiredEvidencePresent: true, unresolvedHighSeverity: 1, furtherCallExpectedValue: "high", budgetReached: false }).stop).toBe(false));
  it("stops visibly when a budget is reached", () => expect(evaluateStoppingRule({ requiredEvidencePresent: true, unresolvedHighSeverity: 1, furtherCallExpectedValue: "high", budgetReached: true })).toEqual({ stop: true, reason: "Configured budget reached; expose remaining gaps and lower the rating" }));
  it("stops when evidence is complete and another call has low value", () => expect(evaluateStoppingRule({ requiredEvidencePresent: true, unresolvedHighSeverity: 0, furtherCallExpectedValue: "low", budgetReached: false }).stop).toBe(true));
});
