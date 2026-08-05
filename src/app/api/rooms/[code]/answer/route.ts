import { NextResponse } from "next/server";
import { scoreAnswer } from "@/lib/scoring";
import {
  getQuizQuestion,
  getRoom,
  mutateRoom,
  StorageNotConfiguredError,
} from "@/lib/store";
import {
  shouldExposeQuestion,
  toPublicQuestion,
  toPublicRoom,
} from "@/lib/public-room";

export const runtime = "nodejs";

type Body = {
  playerId?: string;
  answerIndex?: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
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

    let existing = await getRoom(code);
    for (let i = 0; i < 6 && existing && existing.phase !== "question"; i++) {
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
      existing = await getRoom(code);
    }
    if (!existing) {
      return NextResponse.json({ error: "Комната не найдена" }, { status: 404 });
    }
    if (existing.phase !== "question" || existing.questionStartedAt == null) {
      return NextResponse.json(
        { error: "Сейчас нельзя отвечать" },
        { status: 400 },
      );
    }
    const question = await getQuizQuestion(
      existing.quizId,
      existing.questionIndex,
    );
    if (!question) {
      return NextResponse.json({ error: "Вопрос не найден" }, { status: 400 });
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

      if (player.answers[question.id]) {
        const prev = player.answers[question.id];
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
      const correct = body.answerIndex === question.correctIndex;
      const points = scoreAnswer(correct, timeMs, room.timeLimitMs);

      player.answers[question.id] = {
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

    const reveal =
      room.phase === "reveal" ||
      room.phase === "leaderboard" ||
      room.phase === "finished";
    let publicQ = null;
    if (shouldExposeQuestion(room.phase)) {
      publicQ = toPublicQuestion(question, reveal);
    }

    return NextResponse.json({
      correct: state.correct,
      points: state.points,
      timeMs: state.timeMs,
      alreadyAnswered: state.alreadyAnswered,
      room: toPublicRoom(room, publicQ),
    });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
