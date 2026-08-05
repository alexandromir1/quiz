import type { PublicQuestion, PublicRoom, Room } from "./types";

export function toPublicRoom(
  room: Room,
  question: PublicQuestion | null,
): PublicRoom {
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
    questionCount: room.questionCount,
    currentQuestion: question,
  };
}

export function shouldExposeQuestion(phase: Room["phase"]): boolean {
  return (
    phase === "question" ||
    phase === "reveal" ||
    phase === "leaderboard" ||
    phase === "finished"
  );
}

export function toPublicQuestion(
  question: {
    id: string;
    imageDataUrl: string;
    answers: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
  },
  reveal: boolean,
): PublicQuestion {
  return {
    id: question.id,
    imageDataUrl: question.imageDataUrl,
    answers: question.answers,
    ...(reveal ? { correctIndex: question.correctIndex } : {}),
  };
}
