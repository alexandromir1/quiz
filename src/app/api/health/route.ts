import { NextResponse } from "next/server";
import { hasRedis, pingRedis } from "@/lib/store";

export const runtime = "nodejs";

/** Lightweight check that env vars reached the deployment. */
export async function GET() {
  const redisConfigured = hasRedis();
  const ping = redisConfigured ? await pingRedis() : null;
  return NextResponse.json({
    ok: true,
    vercel: Boolean(process.env.VERCEL),
    redisConfigured,
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    redisPing: ping,
  });
}
