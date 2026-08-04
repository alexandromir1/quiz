"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnswerGrid } from "@/components/answer-grid";
import { CountdownBar } from "@/components/countdown-bar";
import { Leaderboard } from "@/components/leaderboard";
import { useRoomPoll } from "@/lib/use-room-poll";

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();
  const { room, error, loading } = useRoomPoll(code || null, 500);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [lastResult, setLastResult] = useState<{
    correct: boolean;
    points: number;
  } | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [seenQuestionId, setSeenQuestionId] = useState<string | null>(null);

  useEffect(() => {
    const id = localStorage.getItem(`player:${code}`);
    if (!id) {
      router.replace("/join");
      return;
    }
    setPlayerId(id);
  }, [code, router]);

  useEffect(() => {
    const qid = room?.currentQuestion?.id ?? null;
    if (qid && qid !== seenQuestionId) {
      setSeenQuestionId(qid);
      setSelected(null);
      setLocked(false);
      setLastResult(null);
      setAnswerError(null);
    }
  }, [room?.currentQuestion?.id, seenQuestionId]);

  async function submit(answerIndex: number) {
    if (!playerId || locked || room?.phase !== "question") return;
    setSelected(answerIndex);
    setLocked(true);
    setAnswerError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, answerIndex }),
      });
      const data = (await res.json()) as {
        correct?: boolean;
        points?: number;
        error?: string;
        alreadyAnswered?: boolean;
      };
      if (!res.ok) {
        setLocked(false);
        setSelected(null);
        throw new Error(data.error ?? "Не удалось ответить");
      }
      if (typeof data.correct === "boolean" && typeof data.points === "number") {
        setLastResult({ correct: data.correct, points: data.points });
      }
    } catch (e) {
      setAnswerError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  if (loading || !playerId) {
    return (
      <main className="grid min-h-dvh place-items-center px-5 text-[var(--muted)]">
        Подключаемся…
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <p className="text-[var(--coral)]">{error ?? "Комната не найдена"}</p>
        <Link href="/join" className="btn-ghost mt-6 w-fit">
          К входу
        </Link>
      </main>
    );
  }

  const me = room.players.find((p) => p.id === playerId);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="font-[family-name:var(--font-display)] text-lg">
            QuizLive
          </p>
          <p className="text-sm text-[var(--muted)]">{room.quizTitle}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
            Баллы
          </p>
          <p className="font-[family-name:var(--font-display)] text-2xl text-[var(--accent)] tabular-nums">
            {me?.score ?? 0}
          </p>
        </div>
      </header>

      {room.phase === "lobby" && (
        <section className="animate-rise rounded-3xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            В лобби
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl">
            Привет, {me?.name ?? "игрок"}!
          </h1>
          <p className="mt-3 text-[var(--muted)]">
            Жди, пока ведущий начнёт игру. В комнате: {room.players.length}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {room.players.map((p) => (
              <span
                key={p.id}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  p.id === playerId
                    ? "bg-[var(--accent)] text-[var(--bg)]"
                    : "bg-white/8"
                }`}
              >
                {p.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {room.phase === "question" && room.currentQuestion && (
        <section className="animate-rise space-y-5">
          <div className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <span>
              Вопрос {room.questionIndex + 1}/{room.questionCount}
            </span>
            {locked && <span className="text-[var(--accent)]">Ответ принят</span>}
          </div>

          {room.questionStartedAt && (
            <CountdownBar
              startedAt={room.questionStartedAt}
              timeLimitMs={room.timeLimitMs}
            />
          )}

          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-black/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={room.currentQuestion.imageDataUrl}
              alt=""
              className="mx-auto max-h-[36vh] w-full object-contain"
            />
          </div>

          <AnswerGrid
            answers={room.currentQuestion.answers}
            disabled={locked}
            selected={selected}
            onSelect={(i) => void submit(i)}
          />

          {answerError && (
            <p className="text-sm text-[var(--coral)]">{answerError}</p>
          )}
        </section>
      )}

      {room.phase === "reveal" && room.currentQuestion && (
        <section className="animate-rise space-y-5">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 text-center">
            {lastResult ? (
              <>
                <p
                  className={`font-[family-name:var(--font-display)] text-3xl ${
                    lastResult.correct
                      ? "text-[var(--accent)]"
                      : "text-[var(--coral)]"
                  }`}
                >
                  {lastResult.correct ? "Верно!" : "Мимо"}
                </p>
                <p className="mt-2 text-[var(--muted)]">
                  {lastResult.correct
                    ? `+${lastResult.points} баллов`
                    : "0 баллов"}
                </p>
              </>
            ) : (
              <p className="text-[var(--muted)]">Время вышло — без ответа</p>
            )}
          </div>

          <AnswerGrid
            answers={room.currentQuestion.answers}
            disabled
            selected={selected}
            showCorrect
            correctIndex={room.currentQuestion.correctIndex}
          />
        </section>
      )}

      {(room.phase === "leaderboard" || room.phase === "finished") && (
        <section className="animate-rise">
          <Leaderboard
            players={room.players}
            highlightId={playerId}
            title={room.phase === "finished" ? "Итоги" : "Сейчас лидируют"}
          />
          {room.phase === "finished" && (
            <Link href="/" className="btn-ghost mt-8 inline-flex">
              На главную
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
