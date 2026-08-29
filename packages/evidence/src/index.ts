import { randomUUID } from "node:crypto";
import { EvidenceSchema, type Evidence } from "@cronoblox/contracts";

export function createEvidence(input: Omit<Evidence, "id"> & { id?: string }): Evidence {
  return EvidenceSchema.parse({ ...input, id: input.id ?? `ev_${randomUUID().replaceAll("-", "")}` });
}

export function deriveEvidence(input: {
  runId: string; moduleId: string; claim: string; value: unknown; unit: string | null;
  method: string; formula?: string; from: readonly Evidence[]; relationship?: Evidence["relationship"];
}): Evidence {
  if (!input.from.length) throw new Error("Derived evidence needs at least one source evidence record");
  return createEvidence({
    run_id: input.runId, module_id: input.moduleId, kind: "inference", claim: input.claim,
    source: { type: "derived", url: null, retrieved_at: new Date().toISOString(), cache_key: null },
    observation: { value: input.value, unit: input.unit, raw_ref: null },
    derivation: { method: input.method, formula: input.formula ?? null, derived_from: input.from.map((item) => item.id) },
    support_strength: input.from.every((item) => item.support_strength === "high") ? "high" : "medium",
    relationship: input.relationship ?? "contextualizes", related_claim_ids: [], notes: null,
    used_by: ["orchestrator", "critic", "report"],
  });
}

export function validateAppendOnly(existing: readonly Evidence[], next: readonly Evidence[]) {
  const seen = new Set(existing.map((item) => item.id));
  for (const item of next) {
    EvidenceSchema.parse(item);
    if (seen.has(item.id)) throw new Error(`Evidence ID already exists: ${item.id}`);
    seen.add(item.id);
  }
}
