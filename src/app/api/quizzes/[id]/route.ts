import { NextResponse } from "next/server";
import { getQuiz } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const quiz = await getQuiz(id);
  if (!quiz) {
    return NextResponse.json({ error: "Викторина не найдена" }, { status: 404 });
  }

  return NextResponse.json({
    id: quiz.id,
    title: quiz.title,
    questionCount: quiz.questions.length,
    createdAt: quiz.createdAt,
  });
}
