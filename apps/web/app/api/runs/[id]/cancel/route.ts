import { NextResponse } from "next/server";
import { cancelRun } from "@cronoblox/db";
export const runtime = "nodejs";
export async function POST(_: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; await cancelRun(id); return NextResponse.json({ ok: true }); }
