"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnswerGrid } from "@/components/answer-grid";
import { CountdownBar } from "@/components/countdown-bar";
import { Leaderboard } from "@/components/leaderboard";
import { useRoomPoll } from "@/lib/use-room-poll";

export default function HostPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const { room, error, loading } = useRoomPoll(code || null, 600);
  const [hostSecret, setHostSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setHostSecret(localStorage.getItem(`room-host:${code}`));
    setOrigin(window.location.origin);
  }, [code]);

  const joinUrl = useMemo(
    () => (origin ? `${origin}/join` : "/join"),
    [origin],
  );

  const revealQueuedFor = useRef<number | null>(null);

  const runAction = useCallback(
    async (action: "start" | "reveal" | "leaderboard" | "next" | "finish") => {
      if (!hostSecret) return;
      setBusy(true);
      if (action !== "reveal") setActionError(null);
      try {
        const res = await fetch(`/api/rooms/${code}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostSecret, action }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          // Benign races with auto-reveal / double-click
          if (
            action === "reveal" &&
            (res.status === 400 || res.status === 409)
          ) {
            return;
          }
          throw new Error(data.error ?? "Ошибка");
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Ошибка");
      } finally {
        setBusy(false);
      }
    },
    [code, hostSecret],
  );

  useEffect(() => {
    if (!room || room.phase !== "question" || !room.questionStartedAt) return;
    if (revealQueuedFor.current === room.questionIndex) return;

    const remaining =
      room.timeLimitMs - (Date.now() - room.questionStartedAt) + 400;

    const fireReveal = () => {
      if (revealQueuedFor.current === room.questionIndex) return;
      revealQueuedFor.current = room.questionIndex;
      void runAction("reveal");
    };

    if (remaining <= 0) {
      fireReveal();
      return;
    }
    const id = window.setTimeout(fireReveal, remaining);
    return () => window.clearTimeout(id);
  }, [
    room?.phase,
    room?.questionIndex,
    room?.questionStartedAt,
    room?.timeLimitMs,
    runAction,
    room,
  ]);

  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center px-5 text-[var(--muted)]">
        Загрузка комнаты…
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <p className="text-[var(--coral)]">{error ?? "Комната не найдена"}</p>
        <Link href="/" className="btn-ghost mt-6 w-fit">
          На главную
        </Link>
      </main>
    );
  }

  if (!hostSecret) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <p className="text-[var(--coral)]">
          Это экран ведущего. Открой комнату с того же устройства, где создал
          игру.
        </p>
        <Link href="/" className="btn-ghost mt-6 w-fit">
          На главную
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-5 py-6 sm:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-lg"
          >
            QuizLive
          </Link>
          <p className="mt-1 text-sm text-[var(--muted)]">{room.quizTitle}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Код комнаты
          </p>
          <p className="font-[family-name:var(--font-display)] text-4xl tracking-[0.2em] text-[var(--accent)]">
            {room.code}
          </p>
        </div>
      </header>

      {actionError && (
        <p className="mb-4 rounded-xl bg-[var(--coral)]/15 px-4 py-3 text-sm text-[var(--coral)]">
          {actionError}
        </p>
      )}

      {room.phase === "lobby" && (
        <section className="animate-rise">
          <div className="rounded-3xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 sm:p-10">
            <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight sm:text-5xl">
              Ждём игроков
            </h1>
            <p className="mt-3 text-[var(--muted)]">
              Пусть зайдут на{" "}
              <span className="text-[var(--ink)]">{joinUrl}</span> и введут код{" "}
              <span className="text-[var(--accent)]">{room.code}</span>
            </p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {room.players.length === 0 && (
                <li className="text-[var(--muted)]">Пока никого…</li>
              )}
              {room.players.map((p) => (
                <li
                  key={p.id}
                  className="animate-pulse-soft rounded-full bg-white/8 px-4 py-2 font-semibold"
                >
                  {p.name}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-primary mt-10"
              disabled={busy || room.players.length === 0}
              onClick={() => void runAction("start")}
            >
              Начать игру ({room.players.length})
            </button>
          </div>
        </section>
      )}

      {(room.phase === "question" || room.phase === "reveal") &&
        room.currentQuestion && (
          <section className="animate-rise space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--muted)]">
                Вопрос {room.questionIndex + 1} / {room.questionCount}
              </p>
              {room.phase === "question" && room.questionStartedAt && (
                <div className="w-full max-w-sm sm:w-72">
                  <CountdownBar
                    startedAt={room.questionStartedAt}
                    timeLimitMs={room.timeLimitMs}
                  />
                </div>
              )}
              {room.phase === "reveal" && (
                <p className="font-semibold text-[var(--accent)]">
                  Правильный ответ
                </p>
              )}
            </div>

            <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-black/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={room.currentQuestion.imageDataUrl}
                alt=""
                className="mx-auto max-h-[42vh] w-full object-contain"
              />
            </div>

            <AnswerGrid
              answers={room.currentQuestion.answers}
              disabled
              showCorrect={room.phase === "reveal"}
              correctIndex={room.currentQuestion.correctIndex}
            />

            {room.phase === "reveal" && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void runAction("leaderboard")}
                >
                  Таблица лидеров
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void runAction("next")}
                >
                  {room.questionIndex >= room.questionCount - 1
                    ? "Финал"
                    : "Следующий вопрос"}
                </button>
              </div>
            )}
          </section>
        )}

      {room.phase === "leaderboard" && (
        <section className="animate-rise mx-auto max-w-lg">
          <Leaderboard players={room.players} />
          <button
            type="button"
            className="btn-primary mt-8"
            disabled={busy}
            onClick={() => void runAction("next")}
          >
            {room.questionIndex >= room.questionCount - 1
              ? "Итоги"
              : "Дальше"}
          </button>
        </section>
      )}

      {room.phase === "finished" && (
        <section className="animate-rise mx-auto max-w-lg">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
            Финал
          </p>
          <Leaderboard players={room.players} title="Победители" />
          <Link href="/" className="btn-ghost mt-8 inline-flex">
            На главную
          </Link>
        </section>
      )}
    </main>
  );
}
