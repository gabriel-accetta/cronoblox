import { strToU8, zipSync } from "fflate";

export type PluginClient = "claude" | "openai";

export function integrationOrigin(requestUrl: string, configuredUrl?: string): string {
  const url = new URL(configuredUrl?.trim() || requestUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Set CRONOBLOX_PUBLIC_URL to the public HTTPS origin.");
  if (url.username || url.password) throw new Error("The public URL cannot contain credentials.");
  return url.origin;
}

/** Downloads are generated for this deployment, never for a hard-coded demo domain. */
export function pluginFiles(client: PluginClient, origin: string, skill: string): Record<string, string> {
  const endpoint = `${integrationOrigin(origin)}/mcp`;
  const manifest = {
    name: "cronoblox", version: "0.1.0",
    description: "Investigate Roblox games with public data and cited evidence, using your own AI client.",
    author: { name: "Cronoblox", url: "https://github.com/gabriel-accetta/cronoblox" },
    repository: "https://github.com/gabriel-accetta/cronoblox",
    skills: "./skills/", mcpServers: "./.mcp.json",
  };
  const common = {
    ".mcp.json": JSON.stringify({ mcpServers: { cronoblox: { type: "http", url: endpoint } } }, null, 2),
    "skills/investigate-roblox/SKILL.md": skill,
  };
  if (client === "claude") return {
    ...common,
    ".claude-plugin/plugin.json": JSON.stringify(manifest, null, 2),
    "README.md": `# Cronoblox for Claude\n\nIn Claude, open Customize → Plugins, then upload this ZIP as a custom plugin. Review and enable its Cronoblox connector. You may need a paid plan or workspace permission.\n\nIf plugin upload is unavailable, add a custom connector with URL ${endpoint} and attach skills/investigate-roblox/SKILL.md to your conversation or add it as a custom skill.\n\nFor Claude Code, extract this archive to a cronoblox directory and run: claude --plugin-dir ./cronoblox\n\nAsk: Investigate this Roblox game with Cronoblox: <game URL>.\n\nPublic hackathon service. No sign-in or API key. Your AI account handles reasoning under its own limits. No report is saved; the service may be retired after the event. Source observations may be cached in server memory for 60 seconds.\n`,
  };
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(common)) files[`plugins/cronoblox/${path}`] = contents;
  files["plugins/cronoblox/.codex-plugin/plugin.json"] = JSON.stringify({ ...manifest, interface: {
    displayName: "Cronoblox", shortDescription: "Roblox evidence for your AI",
    longDescription: manifest.description, developerName: "Cronoblox", category: "Productivity",
    capabilities: ["Read"], brandColor: "#4D8DFF",
    defaultPrompt: ["Investigate this Roblox game with Cronoblox and challenge the breakout thesis."],
  } }, null, 2);
  files[".agents/plugins/marketplace.json"] = JSON.stringify({
    name: "cronoblox", interface: { displayName: "Cronoblox" }, plugins: [{
      name: "cronoblox", source: { source: "local", path: "./plugins/cronoblox" },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Productivity",
    }],
  }, null, 2);
  files["README.md"] = `# Cronoblox for ChatGPT desktop / Codex\n\nExtract this archive into a folder named cronoblox-plugin, then register that folder:\n\n    codex plugin marketplace add ./cronoblox-plugin\n\nRestart the desktop app, open the Plugins Directory, select the Cronoblox marketplace and install Cronoblox. Start a new conversation. This is a local plugin source, not a public directory listing.\n\nFor ChatGPT web, enable Developer mode if your account permits it, open https://chatgpt.com/plugins and add a custom MCP connection named Cronoblox with URL ${endpoint}. Select No authentication. Enable it in a new chat and attach plugins/cronoblox/skills/investigate-roblox/SKILL.md or use the website's starter prompt.\n\nPublic hackathon service. No API key or Cronoblox account. Your AI plan limits apply. No report is saved; observations may be cached in memory for 60 seconds and the service may be retired after the event.\n`;
  return files;
}

export function pluginArchive(client: PluginClient, origin: string, skill: string): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(pluginFiles(client, origin, skill)).map(([path, text]) => [path, strToU8(text)])), { level: 6 });
}
