import { NextResponse } from "next/server";
import { toPublicRoom } from "@/lib/public-room";
import { mutateRoom } from "@/lib/store";

export const runtime = "nodejs";

type Body = {
  hostSecret?: string;
  action?: "start" | "reveal" | "leaderboard" | "next" | "finish";
};

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const body = (await request.json()) as Body;
  if (!body.hostSecret) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const state = { error: null as string | null, status: 400 };

  const room = await mutateRoom(code, (room) => {
    if (body.hostSecret !== room.hostSecret) {
      state.error = "Нет доступа";
      state.status = 403;
      return;
    }

    switch (body.action) {
      case "start": {
        if (room.phase !== "lobby") {
          state.error = "Игра уже идёт";
          return;
        }
        if (room.players.length === 0) {
          state.error = "Нужен хотя бы один игрок";
          return;
        }
        room.phase = "question";
        room.questionIndex = 0;
        room.questionStartedAt = Date.now();
        break;
      }
      case "reveal": {
        if (room.phase !== "question") {
          state.error = "Сейчас нет вопроса";
          return;
        }
        room.phase = "reveal";
        break;
      }
      case "leaderboard": {
        if (room.phase !== "reveal") {
          state.error = "Сначала покажите ответ";
          return;
        }
        room.phase = "leaderboard";
        break;
      }
      case "next": {
        if (room.phase !== "leaderboard" && room.phase !== "reveal") {
          state.error = "Нельзя перейти дальше";
          return;
        }
        if (room.questionIndex >= room.questions.length - 1) {
          room.phase = "finished";
          room.questionStartedAt = null;
        } else {
          room.questionIndex += 1;
          room.phase = "question";
          room.questionStartedAt = Date.now();
        }
        break;
      }
      case "finish": {
        room.phase = "finished";
        room.questionStartedAt = null;
        break;
      }
      default:
        state.error = "Неизвестное действие";
    }
  });

  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: state.status });
  }

  return NextResponse.json(toPublicRoom(room));
}
