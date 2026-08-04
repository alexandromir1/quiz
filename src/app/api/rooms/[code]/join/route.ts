import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { toPublicRoom } from "@/lib/public-room";
import { mutateRoom } from "@/lib/store";

export const runtime = "nodejs";

type Body = { name?: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const body = (await request.json()) as Body;
  const name = (body.name ?? "").trim().slice(0, 20);
  if (!name) {
    return NextResponse.json({ error: "Введите имя" }, { status: 400 });
  }

  const state = {
    playerId: "",
    error: null as string | null,
    status: 400,
  };

  const room = await mutateRoom(code, (room) => {
    if (room.phase !== "lobby") {
      state.error = "Игра уже началась";
      return;
    }
    if (room.players.length >= 50) {
      state.error = "Комната заполнена";
      return;
    }
    state.playerId = nanoid(12);
    room.players.push({
      id: state.playerId,
      name,
      score: 0,
      answers: {},
    });
  });

  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: state.status });
  }

  return NextResponse.json({
    playerId: state.playerId,
    room: toPublicRoom(room),
  });
}
