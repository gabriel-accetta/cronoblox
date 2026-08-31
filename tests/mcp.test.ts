import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { strFromU8, unzipSync } from "fflate";
import { createMcpHandler, executeDataTool, PublicToolRuntime } from "@cronoblox/mcp";
import { integrationOrigin, pluginArchive } from "@cronoblox/mcp/distribution";
import { PublicToolResultSchema, type PublicToolResult } from "@cronoblox/contracts";

const origin = "https://cronoblox.test";
const observedAt = "2026-08-31T12:00:00.000Z";
const result: PublicToolResult = { status: "completed", observed_at: observedAt, data: { playing: 123 }, evidence: [], warnings: [], cached: false, model_calls: 0 };
const skill = () => readFile(new URL("../apps/web/public/integrations/investigate-roblox/SKILL.md", import.meta.url), "utf8");
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function connect(runtime = new PublicToolRuntime({ execute: async () => result })) {
  const handle = createMcpHandler({ getSkill: skill, tools: runtime, publicOrigin: origin });
  const client = new Client({ name: "cronoblox-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: async (url, init) => handle(new Request(url, init)),
  }));
  return { client, handle };
}

describe("public MCP protocol", () => {
  it("connects with the real SDK, discovers data-only tools, reads the skill and calls a tool", async () => {
    const { client } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "cronoblox_audit_game", "cronoblox_get_chart_games", "cronoblox_list_charts", "cronoblox_search_peers", "cronoblox_search_youtube",
      ]);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint && tool.outputSchema)).toBe(true);
      const response = await client.callTool({ name: "cronoblox_audit_game", arguments: { game_url: "123" } });
      expect(PublicToolResultSchema.parse(response.structuredContent)).toEqual(result);
      expect(response.isError).not.toBe(true);
      const { resources } = await client.listResources();
      const contents = await client.readResource({ uri: resources[0]!.uri });
      expect(contents.contents[0]).toMatchObject({ mimeType: "text/markdown", text: await skill() });
      const prompt = await client.getPrompt({ name: "investigate-roblox", arguments: { game_url: "123" } });
      expect(prompt.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining('"123"') });
    } finally { await client.close(); }
  });

  it("rejects invalid and oversized tool arguments before any data access", async () => {
    const execute = vi.fn(async () => result);
    const { client } = await connect(new PublicToolRuntime({ execute }));
    try {
      for (const args of [{ game_url: "http://127.0.0.1/private" }, { game_url: "123", fixture_mode: true }, { game_url: "x".repeat(513) }]) {
        const response = await client.callTool({ name: "cronoblox_audit_game", arguments: args });
        expect(response.isError).toBe(true);
      }
      expect((await client.callTool({ name: "cronoblox_search_youtube", arguments: { query: "x".repeat(161) } })).isError).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally { await client.close(); }
  });

  it("returns safe, recoverable tool errors without leaking host details", async () => {
    const { client } = await connect(new PublicToolRuntime({ execute: async () => { throw new Error("/private/path secret-token child_process command"); } }));
    try {
      const response = await client.callTool({ name: "cronoblox_search_youtube", arguments: { query: "Roblox" } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain("YouTube search is unavailable");
      expect(JSON.stringify(response)).not.toMatch(/secret-token|private\/path|child_process/);
    } finally { await client.close(); }
  });

  it("enforces transport boundaries including untrusted origins and streamed body size", async () => {
    const handle = createMcpHandler({ getSkill: skill, publicOrigin: origin });
    const post = (body: string, headers: Record<string, string> = {}) => handle(new Request(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
    expect((await post("{}", { origin: "https://untrusted.test" })).status).toBe(403);
    expect((await post("{" )).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post("x".repeat(33 * 1024)))).toMatchObject({ status: 413 });
    expect((await post("{}", { "content-length": String(33 * 1024) })).status).toBe(413);
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await handle(new Request(`${origin}/mcp`))).status).toBe(405);
    const preflight = await handle(new Request(`${origin}/mcp`, { method: "OPTIONS", headers: { origin: "https://claude.ai" } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
  });
});

describe("public tool safeguards", () => {
  it("coalesces concurrent identical calls, preserves timestamps and expires cached results", async () => {
    let now = Date.parse(observedAt);
    let finish!: (result: PublicToolResult) => void;
    const execute = vi.fn(() => new Promise<PublicToolResult>((resolve) => { finish = resolve; }));
    const runtime = new PublicToolRuntime({ execute, now: () => now });
    const one = runtime.call("cronoblox_list_charts", {});
    const two = runtime.call("cronoblox_list_charts", {});
    await Promise.resolve();
    finish(result);
    expect(await one).toEqual(await two);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await runtime.call("cronoblox_list_charts", {})).toMatchObject({ cached: true, observed_at: observedAt });
    now += 60_001;
    const three = runtime.call("cronoblox_list_charts", {});
    await Promise.resolve(); finish(result); await three;
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("caps concurrent provider work and tool calls, then recovers", async () => {
    let finish!: (result: PublicToolResult) => void;
    const runtime = new PublicToolRuntime({ maxConcurrent: 1, execute: () => new Promise((resolve) => { finish = resolve; }) });
    const first = runtime.call("cronoblox_list_charts", {});
    await expect(runtime.call("cronoblox_search_peers", { query: "boat" })).rejects.toThrow("busy");
    finish(result); await first;
    const limited = new PublicToolRuntime({ callsPerMinute: 1, execute: async () => result });
    await limited.call("cronoblox_list_charts", {});
    await expect(limited.call("cronoblox_list_charts", {})).rejects.toThrow("tool-call limit");
  });

  it("aborts slow provider work and does not cache failures", async () => {
    const execute = vi.fn((_name, _args, signal: AbortSignal) => new Promise<PublicToolResult>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const runtime = new PublicToolRuntime({ execute, timeoutMs: 10 });
    await expect(runtime.call("cronoblox_list_charts", {})).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(runtime.call("cronoblox_list_charts", {})).rejects.toMatchObject({ name: "TimeoutError" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("runs the real audit adapter using only Roblox endpoints and degrades missing coverage", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (!url.hostname.endsWith(".roblox.com")) throw new Error(`Unexpected external service: ${url.hostname}`);
      if (url.pathname.includes("/places/")) return Response.json({ universeId: 2 });
      if (url.pathname === "/v1/games") return Response.json({ data: [{
        id: 2, rootPlaceId: 123, name: "Test Game", description: "A test game", creator: { id: 1, name: "Creator", type: "Group" },
        created: observedAt, updated: observedAt, playing: 123, visits: 1000, maxPlayers: 10, favoritedCount: 100,
      }] });
      if (url.pathname.includes("votes")) return new Response("unavailable", { status: 403 });
      if (url.pathname.includes("recommendations")) return Response.json({ games: [] });
      return Response.json({ data: [] });
    });
    vi.stubGlobal("fetch", fetch);
    const response = await executeDataTool("cronoblox_audit_game", { game_url: "123" }, AbortSignal.timeout(3000));
    expect(response).toMatchObject({ status: "degraded", model_calls: 0, data: { playing: 123, visits: 1000, up_votes: null, down_votes: null, like_ratio: null } });
    expect(response.warnings).toContain("Vote data unavailable");
    expect(response.evidence.length).toBeGreaterThan(0);
    const ids = new Set(response.evidence.map((item) => item.id));
    expect(response.evidence.flatMap((item) => item.derivation?.derived_from ?? []).every((id) => ids.has(id))).toBe(true);
    expect(response.evidence.every((item) => item.observation?.raw_ref == null)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(7);
  });
});

describe("plugin distribution", () => {
  it("creates importable ZIPs with one shared skill and deployment-specific MCP URLs", async () => {
    const text = await skill();
    const claude = unzipSync(pluginArchive("claude", origin, text));
    expect(JSON.parse(strFromU8(claude[".claude-plugin/plugin.json"]!))).toMatchObject({ name: "cronoblox", skills: "./skills/", mcpServers: "./.mcp.json" });
    expect(JSON.parse(strFromU8(claude[".mcp.json"]!)).mcpServers.cronoblox).toEqual({ type: "http", url: `${origin}/mcp` });
    expect(strFromU8(claude["skills/investigate-roblox/SKILL.md"]!)).toBe(text);
    const openai = unzipSync(pluginArchive("openai", origin, text));
    const marketplace = JSON.parse(strFromU8(openai[".agents/plugins/marketplace.json"]!));
    const pluginPath = marketplace.plugins[0].source.path.replace(/^\.\//, "");
    expect(JSON.parse(strFromU8(openai[`${pluginPath}/.codex-plugin/plugin.json`]!))).toMatchObject({ name: "cronoblox" });
    expect(strFromU8(openai[`${pluginPath}/skills/investigate-roblox/SKILL.md`]!)).toBe(text);
    expect(Object.keys(openai).some((path) => path.includes("..") || path.startsWith("/"))).toBe(false);
  });

  it("uses the configured public origin behind proxies and refuses insecure public endpoints", () => {
    expect(integrationOrigin("http://localhost:3017", "https://demo.example.com/")).toBe("https://demo.example.com");
    expect(integrationOrigin("http://localhost:3017/api/integrations")).toBe("http://localhost:3017");
    expect(() => integrationOrigin("http://public.example.com")).toThrow("HTTPS");
    expect(() => integrationOrigin("https://user:secret@example.com")).toThrow("credentials");
  });
});
