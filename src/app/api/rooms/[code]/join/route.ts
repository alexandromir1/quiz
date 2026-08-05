import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  getQuizQuestion,
  mutateRoom,
  StorageNotConfiguredError,
} from "@/lib/store";
import {
  shouldExposeQuestion,
  toPublicQuestion,
  toPublicRoom,
} from "@/lib/public-room";

export const runtime = "nodejs";

type Body = { name?: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
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

    const reveal =
      room.phase === "reveal" ||
      room.phase === "leaderboard" ||
      room.phase === "finished";
    let question = null;
    if (shouldExposeQuestion(room.phase)) {
      const q = await getQuizQuestion(room.quizId, room.questionIndex);
      if (q) question = toPublicQuestion(q, reveal);
    }

    return NextResponse.json({
      playerId: state.playerId,
      room: toPublicRoom(room, question),
    });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
