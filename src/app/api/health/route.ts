import { NextResponse } from "next/server";
import { hasRedis } from "@/lib/store";

export const runtime = "nodejs";

/** Lightweight check that env vars reached the deployment. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    vercel: Boolean(process.env.VERCEL),
    redisConfigured: hasRedis(),
  });
}
