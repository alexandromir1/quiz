"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ANSWER_STYLES } from "@/components/answer-grid";
import {
  fileToCompressedDataUrl,
  fileToCompressedJpegBlob,
} from "@/lib/image";

type DraftQuestion = {
  key: string;
  imageDataUrl: string;
  answers: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

function emptyQuestion(): DraftQuestion {
  return {
    key: crypto.randomUUID(),
    imageDataUrl: "",
    answers: ["", "", "", ""],
    correctIndex: 0,
  };
}

async function blobEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/upload", { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { blob?: boolean };
    return Boolean(data.blob);
  } catch {
    return false;
  }
}

async function prepareImage(file: File, requireBlob: boolean): Promise<string> {
  const jpegBlob = await fileToCompressedJpegBlob(file);
  const jpegFile = new File([jpegBlob], "question.jpg", { type: "image/jpeg" });

  const form = new FormData();
  form.append("file", jpegFile);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await res.json().catch(() => null)) as {
    url?: string;
    error?: string;
  } | null;

  if (res.ok && data?.url?.startsWith("https://")) {
    return data.url;
  }

  if (requireBlob) {
    throw new Error(
      data?.error
        ? `Не удалось загрузить фото в Blob: ${data.error}`
        : "Не удалось загрузить фото в Blob. Обнови страницу и попробуй снова.",
    );
  }

  return fileToCompressedDataUrl(file);
}

export default function CreatePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [useBlob, setUseBlob] = useState(false);

  useEffect(() => {
    void blobEnabled().then(setUseBlob);
  }, []);

  async function onImageChange(index: number, file: File | null) {
    if (!file) return;
    setError(null);
    setUploadingIndex(index);
    try {
      const requireBlob = useBlob || (await blobEnabled());
      if (requireBlob) setUseBlob(true);
      const imageDataUrl = await prepareImage(file, requireBlob);
      setQuestions((prev) =>
        prev.map((q, i) => (i === index ? { ...q, imageDataUrl } : q)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать изображение");
    } finally {
      setUploadingIndex(null);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      if (useBlob) {
        const bad = questions.find((q) => !q.imageDataUrl.startsWith("https://"));
        if (bad) {
          throw new Error(
            "Фото ещё в старом формате. Заново выбери изображение для каждого вопроса (после подключения Blob).",
          );
        }
      }

      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          questions: questions.map((q) => ({
            imageDataUrl: q.imageDataUrl,
            answers: q.answers,
            correctIndex: q.correctIndex,
          })),
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        hostSecret?: string;
        error?: string;
      };
      if (!res.ok || !data.id || !data.hostSecret) {
        throw new Error(data.error ?? "Ошибка сохранения");
      }
      localStorage.setItem(`quiz-host:${data.id}`, data.hostSecret);
      router.push(`/quiz/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-8 sm:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]"
        >
          QuizLive
        </Link>
        <span className="text-sm text-[var(--muted)]">Новая викторина</span>
      </div>

      <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight sm:text-5xl">
        Собери вопросы
      </h1>
      <p className="mt-3 text-[var(--muted)]">
        Картинка + четыре варианта. Отметь правильный ответ.
      </p>
      {useBlob && (
        <p className="mt-3 rounded-xl bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--accent)]">
          Blob подключён. После обновления страницы заново выбери каждое фото —
          они загрузятся как ссылки, а не в Redis.
        </p>
      )}

      <label className="mt-8 block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Название
        </span>
        <input
          className="field text-lg"
          value={title}
          maxLength={80}
          placeholder="Например: Угадай фильм"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="mt-10 space-y-8">
        {questions.map((q, qi) => (
          <article
            key={q.key}
            className="rounded-3xl border border-[var(--line)] bg-[var(--bg-elevated)] p-5 sm:p-6"
            style={{ animation: `rise-in 0.45s ease ${qi * 0.04}s both` }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-xl">
                Вопрос {qi + 1}
              </h2>
              {questions.length > 1 && (
                <button
                  type="button"
                  className="text-sm text-[var(--coral)]"
                  onClick={() =>
                    setQuestions((prev) => prev.filter((_, i) => i !== qi))
                  }
                >
                  Удалить
                </button>
              )}
            </div>

            <label className="block cursor-pointer">
              <div
                className={`relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--line)] bg-black/20 ${
                  q.imageDataUrl ? "" : "hover:border-[var(--accent)]/50"
                }`}
              >
                {uploadingIndex === qi ? (
                  <span className="px-4 text-center text-sm text-[var(--accent)]">
                    Сжимаем и загружаем…
                  </span>
                ) : q.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={q.imageDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="px-4 text-center text-sm text-[var(--muted)]">
                    Нажми, чтобы загрузить изображение
                  </span>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) =>
                  void onImageChange(qi, e.target.files?.[0] ?? null)
                }
              />
            </label>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {q.answers.map((answer, ai) => (
                <div key={ai} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setQuestions((prev) =>
                          prev.map((item, i) =>
                            i === qi
                              ? {
                                  ...item,
                                  correctIndex: ai as 0 | 1 | 2 | 3,
                                }
                              : item,
                          ),
                        )
                      }
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${ANSWER_STYLES[ai].bg} ${ANSWER_STYLES[ai].text}`}
                    >
                      {ANSWER_STYLES[ai].label}
                      {q.correctIndex === ai ? " ✓" : ""}
                    </button>
                    <span className="text-xs text-[var(--muted)]">
                      {q.correctIndex === ai
                        ? "правильный"
                        : "нажми букву = верный"}
                    </span>
                  </div>
                  <input
                    className="field"
                    value={answer}
                    maxLength={80}
                    placeholder={`Вариант ${ANSWER_STYLES[ai].label}`}
                    onChange={(e) =>
                      setQuestions((prev) =>
                        prev.map((item, i) => {
                          if (i !== qi) return item;
                          const answers = [...item.answers] as DraftQuestion["answers"];
                          answers[ai] = e.target.value;
                          return { ...item, answers };
                        }),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
        >
          + Ещё вопрос
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Сохраняем…" : "Сохранить викторину"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-[var(--coral)]/15 px-4 py-3 text-sm text-[var(--coral)]">
          {error}
        </p>
      )}
    </main>
  );
}
