import { describe, expect, it } from "vitest";
import { parsePlaceId } from "@cronoblox/source-roblox";

describe("Roblox source boundary", () => {
  it("accepts numeric place IDs", () => expect(parsePlaceId(" 920587237 ")).toBe("920587237"));
  it("extracts IDs from public game URLs", () => expect(parsePlaceId("https://www.roblox.com/games/920587237/Adopt-Me")).toBe("920587237"));
  it("extracts IDs from localized public game URLs", () => expect(parsePlaceId("https://www.roblox.com/pt/games/3016661674/Rogue-Lineage#!/")).toBe("3016661674"));
  it("rejects non-Roblox hosts", () => expect(() => parsePlaceId("https://example.com/games/920587237")).toThrow(/roblox\.com/));
  it("rejects masked URLs without a place ID", () => expect(() => parsePlaceId("https://www.roblox.com/share?code=secret")).toThrow(/place ID/));
});
