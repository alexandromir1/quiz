import { NextResponse } from "next/server";
import {
  getQuizQuestion,
  getRoom,
  StorageNotConfiguredError,
} from "@/lib/store";
import {
  shouldExposeQuestion,
  toPublicQuestion,
  toPublicRoom,
} from "@/lib/public-room";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const room = await getRoom(code.toUpperCase());
    if (!room) {
      return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
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

    return NextResponse.json(toPublicRoom(room, question));
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
