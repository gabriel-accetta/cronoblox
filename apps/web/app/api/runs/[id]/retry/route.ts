import { NextResponse } from "next/server";
import { resetFailedRun } from "@cronoblox/db";
import { enqueueRun } from "@/lib/queue";
export const runtime = "nodejs";
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; await resetFailedRun(id); await enqueueRun(id); return NextResponse.json({ ok: true }); }
