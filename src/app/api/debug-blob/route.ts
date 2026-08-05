import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Temporary diagnostics for Blob read path. */
export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "no blob token" }, { status: 503 });
  }

  const pathname = `diagnostics/${Date.now()}.json`;
  const payload = { hello: "blob", at: Date.now() };

  const uploaded = await put(pathname, JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });

  const origin = new URL(uploaded.url).origin;
  const constructed = `${origin}/${pathname}`;

  const fetchExact = await fetch(uploaded.url, { cache: "no-store" });
  const fetchConstructed = await fetch(constructed, { cache: "no-store" });

  // Also try known quiz that exists
  const known = `${origin}/quizzes/qFm9V68Ff4t2.json`;
  const fetchKnown = await fetch(known, { cache: "no-store" });

  return NextResponse.json({
    readMode: "direct-v2",
    uploadedUrl: uploaded.url,
    pathname: uploaded.pathname,
    origin,
    constructed,
    exactStatus: fetchExact.status,
    exactBody: (await fetchExact.text()).slice(0, 80),
    constructedStatus: fetchConstructed.status,
    constructedBody: (await fetchConstructed.text()).slice(0, 80),
    knownStatus: fetchKnown.status,
    knownBody: (await fetchKnown.text()).slice(0, 80),
  });
}
