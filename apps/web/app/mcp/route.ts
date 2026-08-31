import { createMcpHandler } from "@cronoblox/mcp";
import { getInvestigationSkill } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handle = createMcpHandler({
  getSkill: getInvestigationSkill,
  publicOrigin: process.env.CRONOBLOX_PUBLIC_URL ? new URL(process.env.CRONOBLOX_PUBLIC_URL).origin : undefined,
});
export { handle as POST, handle as GET, handle as DELETE, handle as OPTIONS };
