import { NextResponse } from "next/server";
import { scoreAnswer } from "@/lib/scoring";
import { toPublicRoom } from "@/lib/public-room";
import { mutateRoom } from "@/lib/store";

export const runtime = "nodejs";

type Body = {
  playerId?: string;
  answerIndex?: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const body = (await request.json()) as Body;

  if (
    typeof body.answerIndex !== "number" ||
    body.answerIndex < 0 ||
    body.answerIndex > 3
  ) {
    return NextResponse.json({ error: "Некорректный ответ" }, { status: 400 });
  }
  if (!body.playerId) {
    return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
  }

  const state = {
    error: null as string | null,
    status: 400,
    correct: false,
    points: 0,
    timeMs: 0,
    alreadyAnswered: false,
    hasPayload: false,
  };

  const room = await mutateRoom(code, (room) => {
    if (room.phase !== "question" || room.questionStartedAt == null) {
      state.error = "Сейчас нельзя отвечать";
      return;
    }

    const player = room.players.find((p) => p.id === body.playerId);
    if (!player) {
      state.error = "Игрок не найден";
      state.status = 404;
      return;
    }

    const q = room.questions[room.questionIndex];
    if (!q) {
      state.error = "Вопрос не найден";
      return;
    }

    if (player.answers[q.id]) {
      const prev = player.answers[q.id];
      state.correct = prev.correct;
      state.points = prev.points;
      state.timeMs = prev.timeMs;
      state.alreadyAnswered = true;
      state.hasPayload = true;
      return;
    }

    const elapsed = Date.now() - room.questionStartedAt;
    if (elapsed > room.timeLimitMs + 1500) {
      state.error = "Время вышло";
      return;
    }

    const timeMs = Math.min(elapsed, room.timeLimitMs);
    const correct = body.answerIndex === q.correctIndex;
    const points = scoreAnswer(correct, timeMs, room.timeLimitMs);

    player.answers[q.id] = {
      answerIndex: body.answerIndex!,
      timeMs,
      correct,
      points,
    };
    player.score += points;

    state.correct = correct;
    state.points = points;
    state.timeMs = timeMs;
    state.hasPayload = true;
  });

  if (!room) {
    return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
  }
  if (state.error) {
    return NextResponse.json({ error: state.error }, { status: state.status });
  }
  if (!state.hasPayload) {
    return NextResponse.json(
      { error: "Не удалось сохранить ответ" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    correct: state.correct,
    points: state.points,
    timeMs: state.timeMs,
    alreadyAnswered: state.alreadyAnswered,
    room: toPublicRoom(room),
  });
}
