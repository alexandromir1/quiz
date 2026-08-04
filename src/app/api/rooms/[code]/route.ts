import { NextResponse } from "next/server";
import { toPublicRoom } from "@/lib/public-room";
import { getRoom } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const room = await getRoom(code.toUpperCase());
  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  return NextResponse.json(toPublicRoom(room));
}
