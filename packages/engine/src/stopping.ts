export interface StopInput {
  requiredEvidencePresent: boolean;
  unresolvedHighSeverity: number;
  furtherCallExpectedValue: "low" | "medium" | "high";
  budgetReached: boolean;
}

export function evaluateStoppingRule(input: StopInput) {
  if (input.unresolvedHighSeverity > 0 && !input.budgetReached) return { stop: false, reason: "Resolve high-severity critic objection" } as const;
  if (input.budgetReached) return { stop: true, reason: "Configured budget reached; expose remaining gaps and reduce confidence" } as const;
  if (!input.requiredEvidencePresent) return { stop: false, reason: "Required core evidence is missing" } as const;
  if (input.furtherCallExpectedValue === "low") return { stop: true, reason: "Required evidence is present and another call has low expected value" } as const;
  return { stop: false, reason: "A useful enabled follow-up remains" } as const;
}
