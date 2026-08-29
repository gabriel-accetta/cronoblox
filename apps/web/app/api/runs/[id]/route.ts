import { NextResponse } from "next/server";
import { getReport, getRunSummary, listEvents } from "@cronoblox/db";
export const runtime = "nodejs";
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; const run = await getRunSummary(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run, events: await listEvents(id), report: await getReport(id) });
}
