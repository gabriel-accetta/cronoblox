import { pluginArchive } from "@cronoblox/mcp/distribution";
import { getIntegrationOrigin, getInvestigationSkill } from "@/lib/integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const client = new URL(request.url).searchParams.get("client");
  if (client !== "claude" && client !== "openai") return Response.json({ error: "Choose claude or openai." }, { status: 400 });
  try {
    const archive = pluginArchive(client, getIntegrationOrigin(request), await getInvestigationSkill());
    return new Response(new Uint8Array(archive), { headers: {
      "content-type": "application/zip", "content-disposition": `attachment; filename="cronoblox-${client}-plugin.zip"`,
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  } catch { return Response.json({ error: "The plugin download is unavailable. Check the host's public URL and skill assets." }, { status: 503 }); }
}
