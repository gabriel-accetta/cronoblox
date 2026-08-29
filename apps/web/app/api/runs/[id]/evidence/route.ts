import { NextResponse } from "next/server";
import { listRunEvidence } from "@cronoblox/db";
export const runtime = "nodejs";
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; return NextResponse.json({ evidence: await listRunEvidence(id) }); }
