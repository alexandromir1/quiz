import type { Room } from "./types";

/** Kahoot-style: correct answers get 500–1000 pts based on speed */
export function scoreAnswer(
  correct: boolean,
  timeMs: number,
  timeLimitMs: number,
): number {
  if (!correct) return 0;
  const clamped = Math.min(Math.max(timeMs, 0), timeLimitMs);
  const ratio = 1 - clamped / timeLimitMs;
  return Math.round(500 + 500 * ratio);
}

export function roomLeaderboard(room: Room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: p.score,
    }));
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
