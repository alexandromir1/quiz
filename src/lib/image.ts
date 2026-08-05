/** Compress an image to a small JPEG data URL (for Redis fallback). */
export async function fileToCompressedDataUrl(file: File): Promise<string> {
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
    let last = "";
    for (const step of steps) {
      last = encodeBitmap(bitmap, step.maxEdge, step.quality);
      if (estimateBytes(last) <= maxBytes) return last;
    }
    return last;
  } finally {
    bitmap.close();
  }
}

/** Compress to a JPEG File for Blob upload. */
export async function fileToCompressedJpegFile(file: File): Promise<File> {
  const dataUrl = await fileToCompressedDataUrl(file);
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], "question.jpg", { type: "image/jpeg" });
}

function encodeBitmap(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): string {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function estimateBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((b64.length * 3) / 4);
}
