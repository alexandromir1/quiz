"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function QuizReadyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [count, setCount] = useState(0);
  const [timeLimitSec, setTimeLimitSec] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [missingSecret, setMissingSecret] = useState(false);

  useEffect(() => {
    const id = params.id;
    if (!id) return;
    void (async () => {
      const res = await fetch(`/api/quizzes/${id}`);
      if (!res.ok) {
        setError("Викторина не найдена");
        return;
      }
      const data = (await res.json()) as {
        title: string;
        questionCount: number;
      };
      setTitle(data.title);
      setCount(data.questionCount);
      if (!localStorage.getItem(`quiz-host:${id}`)) {
        setMissingSecret(true);
      }
    })();
  }, [params.id]);

  async function startRoom() {
    const id = params.id;
    const hostSecret = localStorage.getItem(`quiz-host:${id}`);
    if (!hostSecret) {
      setMissingSecret(true);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: id, hostSecret, timeLimitSec }),
      });
      const data = (await res.json()) as {
        code?: string;
        hostSecret?: string;
        error?: string;
      };
      if (!res.ok || !data.code || !data.hostSecret) {
        throw new Error(data.error ?? "Не удалось создать комнату");
      }
      localStorage.setItem(`room-host:${data.code}`, data.hostSecret);
      router.push(`/host/${data.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-5 py-10">
      <Link
        href="/"
        className="mb-10 font-[family-name:var(--font-display)] text-lg"
      >
        QuizLive
      </Link>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
        Викторина готова
      </p>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl tracking-tight sm:text-5xl">
        {title || "…"}
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        {count} {count === 1 ? "вопрос" : count < 5 ? "вопроса" : "вопросов"} ·
        запусти комнату и раздай код игрокам
      </p>

      <label className="mt-8 block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Секунд на ответ
        </span>
        <input
          type="number"
          min={5}
          max={60}
          className="field"
          value={timeLimitSec}
          onChange={(e) => setTimeLimitSec(Number(e.target.value) || 20)}
        />
      </label>

      {missingSecret && (
        <p className="mt-4 rounded-xl bg-[var(--coral)]/15 px-4 py-3 text-sm text-[var(--coral)]">
          Ключ ведущего не найден в этом браузере. Создай викторину заново с
          этого устройства.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-[var(--coral)]/15 px-4 py-3 text-sm text-[var(--coral)]">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn-primary mt-8 w-full sm:w-auto"
        disabled={starting || missingSecret}
        onClick={() => void startRoom()}
      >
        {starting ? "Создаём комнату…" : "Открыть лобби"}
      </button>
    </main>
  );
}
