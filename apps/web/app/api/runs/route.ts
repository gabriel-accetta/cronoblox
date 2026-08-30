import { NextResponse } from "next/server";
import { AnalysisInputSchema } from "@cronoblox/contracts";
import { getProfile } from "@cronoblox/config";
import { createRun, listRecentRuns } from "@cronoblox/db";
import { enqueueRun } from "@/lib/queue";
export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json({ runs: await listRecentRuns(12) }); }
  catch { return NextResponse.json({ runs: [], degraded: true }); }
}
export async function POST(request: Request) {
  try {
    const input = AnalysisInputSchema.parse(await request.json());
    const profile = getProfile(input.profile_id, input.effort);
    if (!profile.fixture_mode && !process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "Live synthesis needs OPENROUTER_API_KEY. Choose Demo replay for a keyless, visibly labeled walkthrough." }, { status: 422 });
    const run = await createRun(input, profile); await enqueueRun(run.id);
    return NextResponse.json({ run_id: run.id, state: run.state }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 }); }
}
