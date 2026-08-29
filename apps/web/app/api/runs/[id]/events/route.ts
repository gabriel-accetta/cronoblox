import { NextResponse } from "next/server";
import { listEvents } from "@cronoblox/db";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
  return NextResponse.json({ events: await listEvents(id, Number.isFinite(after) ? after : -1) });
}
