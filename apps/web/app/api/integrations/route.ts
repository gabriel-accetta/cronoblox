import { getIntegrationOrigin } from "@/lib/integrations";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const origin = getIntegrationOrigin(request);
    return Response.json({ endpoint: `${origin}/mcp`, local: new URL(origin).protocol !== "https:", authentication: "none" }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ error: "The host must configure CRONOBLOX_PUBLIC_URL with its public HTTPS address." }, { status: 503 }); }
}
