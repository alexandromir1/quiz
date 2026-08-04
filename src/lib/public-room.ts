import type { PublicRoom, Room } from "./types";

export function toPublicRoom(room: Room): PublicRoom {
  const reveal =
    room.phase === "reveal" ||
    room.phase === "leaderboard" ||
    room.phase === "finished";

  const q = room.questions[room.questionIndex] ?? null;
  const currentQuestion =
    q && (room.phase === "question" || reveal)
      ? {
          id: q.id,
          imageDataUrl: q.imageDataUrl,
          answers: q.answers,
          ...(reveal ? { correctIndex: q.correctIndex } : {}),
        }
      : null;

  return {
    code: room.code,
    quizTitle: room.quizTitle,
    phase: room.phase,
    questionIndex: room.questionIndex,
    questionStartedAt: room.questionStartedAt,
    timeLimitMs: room.timeLimitMs,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
    })),
    questionCount: room.questions.length,
    currentQuestion,
  };
}
