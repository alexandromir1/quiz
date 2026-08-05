import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { saveQuiz, StorageNotConfiguredError } from "@/lib/store";
import type { Question, Quiz } from "@/lib/types";

export const runtime = "nodejs";

type CreateBody = {
  title?: string;
  questions?: Array<{
    imageDataUrl?: string;
    answers?: string[];
    correctIndex?: number;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBody;
    const title = (body.title ?? "").trim();
    if (!title || title.length > 80) {
      return NextResponse.json(
        { error: "Укажите название викторины (до 80 символов)" },
        { status: 400 },
      );
    }
    if (!body.questions?.length) {
      return NextResponse.json(
        { error: "Добавьте хотя бы один вопрос" },
        { status: 400 },
      );
    }
    if (body.questions.length > 40) {
      return NextResponse.json(
        { error: "Максимум 40 вопросов" },
        { status: 400 },
      );
    }

    const questions: Question[] = [];
    for (const q of body.questions) {
      if (!q.imageDataUrl?.startsWith("data:image/")) {
        return NextResponse.json(
          { error: "Каждый вопрос должен содержать изображение" },
          { status: 400 },
        );
      }
      if (q.imageDataUrl.length > 1_400_000) {
        return NextResponse.json(
          { error: "Изображение слишком большое" },
          { status: 400 },
        );
      }
      const answers = (q.answers ?? []).map((a) => a.trim());
      if (answers.length !== 4 || answers.some((a) => !a || a.length > 80)) {
        return NextResponse.json(
          { error: "Нужны 4 варианта ответа (до 80 символов каждый)" },
          { status: 400 },
        );
      }
      if (
        typeof q.correctIndex !== "number" ||
        q.correctIndex < 0 ||
        q.correctIndex > 3
      ) {
        return NextResponse.json(
          { error: "Отметьте правильный ответ" },
          { status: 400 },
        );
      }
      questions.push({
        id: nanoid(10),
        imageDataUrl: q.imageDataUrl,
        answers: answers as [string, string, string, string],
        correctIndex: q.correctIndex as 0 | 1 | 2 | 3,
      });
    }

    const quiz: Quiz = {
      id: nanoid(12),
      title,
      questions,
      createdAt: Date.now(),
      hostSecret: nanoid(24),
    };

    await saveQuiz(quiz);

    return NextResponse.json({
      id: quiz.id,
      hostSecret: quiz.hostSecret,
      title: quiz.title,
      questionCount: quiz.questions.length,
    });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : "Не удалось сохранить";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
