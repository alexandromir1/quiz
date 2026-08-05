import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function GET() {
  return NextResponse.json({ blob: hasBlob() });
}

export async function POST(request: Request) {
  if (!hasBlob()) {
    return NextResponse.json(
      {
        error: "blob_not_configured",
        message: "Blob storage is not configured",
      },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Нет файла" }, { status: 400 });
    }
    if (file.size > 1_500_000) {
      return NextResponse.json(
        { error: "Файл слишком большой" },
        { status: 400 },
      );
    }

    const blob = await put(`quiz/${nanoid(12)}.jpg`, file, {
      access: "public",
      contentType: "image/jpeg",
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
