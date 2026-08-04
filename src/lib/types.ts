export type Question = {
  id: string;
  imageDataUrl: string;
  answers: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export type Quiz = {
  id: string;
  title: string;
  questions: Question[];
  createdAt: number;
  hostSecret: string;
};

export type PlayerAnswer = {
  answerIndex: number;
  timeMs: number;
  correct: boolean;
  points: number;
};

export type Player = {
  id: string;
  name: string;
  score: number;
  answers: Record<string, PlayerAnswer>;
};

export type GamePhase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

export type Room = {
  code: string;
  quizId: string;
  quizTitle: string;
  hostSecret: string;
  phase: GamePhase;
  questionIndex: number;
  questionStartedAt: number | null;
  timeLimitMs: number;
  players: Player[];
  questions: Question[];
  createdAt: number;
};

/** Public room snapshot without correct answers until reveal/finished */
export type PublicQuestion = {
  id: string;
  imageDataUrl: string;
  answers: [string, string, string, string];
  correctIndex?: 0 | 1 | 2 | 3;
};

export type PublicRoom = {
  code: string;
  quizTitle: string;
  phase: GamePhase;
  questionIndex: number;
  questionStartedAt: number | null;
  timeLimitMs: number;
  players: Array<{
    id: string;
    name: string;
    score: number;
  }>;
  questionCount: number;
  currentQuestion: PublicQuestion | null;
};
