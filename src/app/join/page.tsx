"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function join() {
    setError(null);
    setLoading(true);
    const normalized = code.trim().toUpperCase();
    try {
      const res = await fetch(`/api/rooms/${normalized}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as {
        playerId?: string;
        error?: string;
      };
      if (!res.ok || !data.playerId) {
        throw new Error(data.error ?? "Не удалось войти");
      }
      localStorage.setItem(`player:${normalized}`, data.playerId);
      localStorage.setItem(`player-name:${normalized}`, name.trim());
      router.push(`/play/${normalized}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <Link
        href="/"
        className="mb-10 font-[family-name:var(--font-display)] text-lg"
      >
        QuizLive
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
        Войти в игру
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        Введи код с экрана ведущего и своё имя.
      </p>

      <label className="mt-8 block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Код комнаты
        </span>
        <input
          className="field font-[family-name:var(--font-display)] text-2xl tracking-[0.3em] uppercase"
          value={code}
          maxLength={6}
          placeholder="ABCD12"
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Твоё имя
        </span>
        <input
          className="field text-lg"
          value={name}
          maxLength={20}
          placeholder="Как тебя зовут?"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {error && (
        <p className="mt-4 rounded-xl bg-[var(--coral)]/15 px-4 py-3 text-sm text-[var(--coral)]">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn-primary mt-8 w-full"
        disabled={loading || code.trim().length < 4 || !name.trim()}
        onClick={() => void join()}
      >
        {loading ? "Входим…" : "Играть"}
      </button>
    </main>
  );
}
