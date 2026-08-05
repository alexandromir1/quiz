import { NextResponse } from "next/server";
import { hasBlob, hasRedis, pingRedis } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const ping = hasBlob() ? await pingRedis() : null;
  return NextResponse.json({
    ok: true,
    vercel: Boolean(process.env.VERCEL),
    blob: hasBlob(),
    redisConfigured: hasRedis(),
    storagePing: ping,
  });
}
