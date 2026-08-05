import { NextResponse } from "next/server";
import { generateRoomCode } from "@/lib/scoring";
import {
  getQuiz,
  getRoom,
  saveRoom,
  StorageNotConfiguredError,
  StorageTooLargeError,
} from "@/lib/store";
import type { Room } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  quizId?: string;
  hostSecret?: string;
  timeLimitSec?: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const quiz = body.quizId ? await getQuiz(body.quizId) : null;
    if (!quiz) {
      return NextResponse.json({ error: "Викторина не найдена" }, { status: 404 });
    }
    if (!body.hostSecret || body.hostSecret !== quiz.hostSecret) {
      return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    }

    const timeLimitSec = Math.min(
      Math.max(Number(body.timeLimitSec) || 20, 5),
      60,
    );

    let code = generateRoomCode();
    for (let i = 0; i < 8; i++) {
      if (!(await getRoom(code))) break;
      code = generateRoomCode();
    }

    const room: Room = {
      code,
      quizId: quiz.id,
      quizTitle: quiz.title,
      hostSecret: quiz.hostSecret,
      phase: "lobby",
      questionIndex: 0,
      questionStartedAt: null,
      timeLimitMs: timeLimitSec * 1000,
      players: [],
      questionCount: quiz.questions.length,
      createdAt: Date.now(),
    };

    await saveRoom(room);

    return NextResponse.json({ code: room.code, hostSecret: room.hostSecret });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof StorageTooLargeError) {
      return NextResponse.json({ error: e.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: "Не удалось создать комнату" },
      { status: 500 },
    );
  }
}
