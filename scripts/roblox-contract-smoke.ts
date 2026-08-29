import { RobloxSource } from "@cronoblox/source-roblox";

const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
try {
  const result = await new RobloxSource().audit("920587237", controller.signal);
  if (!result.core.name || !result.core.universeId) throw new Error("Roblox identity contract returned an incomplete record");
  console.log(`Roblox contract OK: ${result.core.name} (universe ${result.core.universeId}); ${result.warnings.length} degraded optional sources.`);
} finally { clearTimeout(timeout); }
