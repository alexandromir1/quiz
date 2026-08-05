"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type QuizMeta = {
  title: string;
  questionCount: number;
};

async function fetchQuizMeta(id: string): Promise<QuizMeta> {
  let lastError = "Викторина не найдена";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`/api/quizzes/${id}`, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as
      | { title?: string; questionCount?: number; error?: string }
      | null;
    if (res.ok && data?.title && typeof data.questionCount === "number") {
      return { title: data.title, questionCount: data.questionCount };
    }
    lastError = data?.error ?? lastError;
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  throw new Error(lastError);
}

export default function QuizReadyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [count, setCount] = useState(0);
  const [timeLimitSec, setTimeLimitSec] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [missingSecret, setMissingSecret] = useState(false);

  useEffect(() => {
    const id = params.id;
    if (!id) return;

    const cached = localStorage.getItem(`quiz-meta:${id}`);
    if (cached) {
      try {
        const meta = JSON.parse(cached) as QuizMeta;
        setTitle(meta.title);
        setCount(meta.questionCount);
      } catch {
        // ignore
      }
    }

    if (!localStorage.getItem(`quiz-host:${id}`)) {
      setMissingSecret(true);
    }

    void (async () => {
      try {
        const meta = await fetchQuizMeta(id);
        setTitle(meta.title);
        setCount(meta.questionCount);
        localStorage.setItem(`quiz-meta:${id}`, JSON.stringify(meta));
        setError(null);
      } catch (e) {
        if (!cached) {
          setError(e instanceof Error ? e.message : "Викторина не найдена");
        }
      } finally {
        setLoading(false);
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
      let data: { code?: string; hostSecret?: string; error?: string } | null =
        null;
      let res: Response | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quizId: id, hostSecret, timeLimitSec }),
        });
        data = (await res.json()) as {
          code?: string;
          hostSecret?: string;
          error?: string;
        };
        if (res.ok && data.code && data.hostSecret) break;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
      if (!res?.ok || !data?.code || !data.hostSecret) {
        throw new Error(data?.error ?? "Не удалось создать комнату");
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
        {title || (loading ? "Загрузка…" : "…")}
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
        disabled={starting || missingSecret || (!title && loading)}
        onClick={() => void startRoom()}
      >
        {starting ? "Создаём комнату…" : "Открыть лобби"}
      </button>
    </main>
  );
}
