import { afterEach, describe, expect, it, vi } from "vitest";
import { WebPageSource } from "../packages/sources/webpage/src/index";

describe("readable source spot-checks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads Roblox API JSON without treating strings as HTML", async () => {
    const body = JSON.stringify({ data: [{ name: "Merge <a> Spinner", playing: 6951 }] });
    vi.stubGlobal("fetch", async () => new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } }));
    const result = await new WebPageSource().fetchReadable("https://games.roblox.com/v1/games?universeIds=10526166728", new AbortController().signal);
    expect(result).toMatchObject({ text: body, title: null, truncated: false });
  });

  it("still extracts HTML titles/text, removes scripts and bounds output", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html><title>Game</title><body><script>private</script><p>Some readable game details.</p></body></html>", { headers: { "content-type": "text/html" } }));
    const result = await new WebPageSource().fetchReadable("https://example.com/game", new AbortController().signal, 10);
    expect(result.title).toBe("Game");
    expect(result.text).not.toContain("private");
    expect(result.text).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });
});
