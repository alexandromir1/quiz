/** Compress an image to a small JPEG Blob (preferred for uploads). */
export async function fileToCompressedJpegBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxBytes = 45_000;
  const steps: Array<{ maxEdge: number; quality: number }> = [
    { maxEdge: 640, quality: 0.55 },
    { maxEdge: 520, quality: 0.45 },
    { maxEdge: 420, quality: 0.38 },
    { maxEdge: 360, quality: 0.32 },
    { maxEdge: 280, quality: 0.28 },
    { maxEdge: 220, quality: 0.24 },
  ];

  try {
    let last: Blob | null = null;
    for (const step of steps) {
      last = await encodeBitmapToBlob(bitmap, step.maxEdge, step.quality);
      if (last.size <= maxBytes) return last;
    }
    if (!last) throw new Error("Не удалось сжать изображение");
    return last;
  } finally {
    bitmap.close();
  }
}

/** @deprecated use fileToCompressedJpegBlob + File wrapper */
export async function fileToCompressedJpegFile(file: File): Promise<File> {
  const blob = await fileToCompressedJpegBlob(file);
  return new File([blob], "question.jpg", { type: "image/jpeg" });
}

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  const blob = await fileToCompressedJpegBlob(file);
  return blobToDataUrl(blob);
}

function encodeBitmapToBlob(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unavailable"));
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("toBlob failed"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
