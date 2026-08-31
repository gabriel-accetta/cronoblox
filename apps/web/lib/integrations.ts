import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { integrationOrigin } from "@cronoblox/mcp/distribution";

let skill: Promise<string> | undefined;
export function getInvestigationSkill() {
  return skill ??= readFile(join(process.cwd(), "public/integrations/investigate-roblox/SKILL.md"), "utf8").catch((error) => { skill = undefined; throw error; });
}
export function getIntegrationOrigin(request: Request) {
  return integrationOrigin(request.url, process.env.CRONOBLOX_PUBLIC_URL);
}
