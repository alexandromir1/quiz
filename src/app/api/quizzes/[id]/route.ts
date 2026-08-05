import { NextResponse } from "next/server";
import { getQuiz, StorageNotConfiguredError } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const quiz = await getQuiz(id);
    if (!quiz) {
      return NextResponse.json(
        { error: "Викторина не найдена" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      id: quiz.id,
      title: quiz.title,
      questionCount: quiz.questions.length,
      createdAt: quiz.createdAt,
    });
  } catch (e) {
    if (e instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
