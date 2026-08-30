import { describe, expect, it } from "vitest";
import { getProfile } from "@cronoblox/config";
import { P0_EXECUTION_ORDER, registry } from "@cronoblox/engine";

describe("module registry", () => {
  it("locks Module 2 into every normal profile", () => { for (const id of ["baseline", "research-no-critic", "full"]) expect(getProfile(id).enabled_modules[0]).toBe("roblox-data"); });
  it("enforces Module 2 before planning or optional research", () => expect(P0_EXECUTION_ORDER[0]).toBe("roblox-data"));
  it("prevents disabled modules from being selected", () => expect(() => registry.assertSelectable("critic", getProfile("baseline"))).toThrow(/disabled/));
  it("uses explicit, unique module IDs", () => expect(new Set(registry.list().map((item) => item.manifest.id)).size).toBe(5));
});
