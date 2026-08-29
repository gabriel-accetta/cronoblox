import { NextResponse } from "next/server";
import { profiles } from "@cronoblox/config";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ profiles: Object.values(profiles) }); }
