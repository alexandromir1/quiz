import { get, list, put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";
import type { Question, Quiz, Room } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Нужно подключить Vercel Blob: Storage → Create → Blob, затем Redeploy.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

export class StorageTooLargeError extends Error {
  constructor() {
    super("Хранилище отклонило данные. Попробуй ещё раз.");
    this.name = "StorageTooLargeError";
  }
}

type StoreShape = {
  quizzes: Record<string, Quiz>;
  rooms: Record<string, Room>;
};

const globalStore = globalThis as typeof globalThis & {
  __quizMemory?: StoreShape;
  __blobUrlCache?: Map<string, string>;
};

function memory(): StoreShape {
  if (!globalStore.__quizMemory) {
    globalStore.__quizMemory = { quizzes: {}, rooms: {} };
  }
  return globalStore.__quizMemory;
}

function urlCache() {
  if (!globalStore.__blobUrlCache) {
    globalStore.__blobUrlCache = new Map();
  }
  return globalStore.__blobUrlCache;
}

function isVercel() {
  return Boolean(process.env.VERCEL);
}

export function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function hasRedis() {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

function requireStore() {
  if (hasBlob()) return;
  if (!isVercel()) return;
  throw new StorageNotConfiguredError();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFileStore<T>(file: string): Promise<Record<string, T>> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

async function writeFileStore<T>(file: string, data: Record<string, T>) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data), "utf8");
}

async function streamToText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

async function blobPutJson(pathname: string, data: unknown): Promise<string> {
  const result = await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  urlCache().set(pathname, result.url);
  return result.url;
}

function blobOriginFromToken(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token?.startsWith("vercel_blob_rw_")) return null;
  // vercel_blob_rw_<storeId>_<secret>
  const rest = token.slice("vercel_blob_rw_".length);
  const storeId = rest.split("_")[0];
  if (!storeId) return null;
  return `https://${storeId}.public.blob.vercel-storage.com`;
}

async function resolveUrl(pathname: string): Promise<string | null> {
  const cached = urlCache().get(pathname);
  if (cached) return cached;

  const origin = blobOriginFromToken();
  if (origin) {
    const url = `${origin}/${pathname}`;
    urlCache().set(pathname, url);
    return url;
  }

  try {
    const listed = await list({ prefix: pathname, limit: 20 });
    const match = listed.blobs.find((b) => b.pathname === pathname);
    if (match?.url) {
      urlCache().set(pathname, match.url);
      return match.url;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchJsonAuthed<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      "User-Agent": "QuizLiveStorage/1.0",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Blob fetch ${res.status}`);
  }
  return (await res.json()) as T;
}

async function blobGetJson<T>(pathname: string): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // 1) Official SDK get
    try {
      const result = await get(pathname, {
        access: "public",
        useCache: false,
      });
      if (result?.statusCode === 200 && result.stream) {
        const text = await streamToText(result.stream);
        return JSON.parse(text) as T;
      }
    } catch {
      // fall through to authed URL fetch
    }

    // 2) Authed fetch via known/listed URL (works around CDN 403)
    try {
      const url = await resolveUrl(pathname);
      if (url) {
        const data = await fetchJsonAuthed<T>(url);
        if (data) return data;
      }
    } catch {
      // retry
    }

    await sleep(120 * (attempt + 1));
  }
  return null;
}

export async function pingRedis(): Promise<{
  ok: boolean;
  error?: string;
  latencyMs?: number;
  storage?: string;
}> {
  if (hasBlob()) {
    const started = Date.now();
    try {
      const key = `ping/${Date.now()}.json`;
      await blobPutJson(key, { ok: true });
      const got = await blobGetJson<{ ok: boolean }>(key);
      return {
        ok: got?.ok === true,
        latencyMs: Date.now() - started,
        storage: "blob",
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - started,
        storage: "blob",
      };
    }
  }
  return { ok: false, error: "blob_not_configured", storage: "none" };
}

export async function saveQuiz(quiz: Quiz): Promise<void> {
  requireStore();
  if (hasBlob()) {
    await blobPutJson(`quizzes/${quiz.id}.json`, quiz);
    for (let i = 0; i < 5; i++) {
      const got = await blobGetJson<Quiz>(`quizzes/${quiz.id}.json`);
      if (got?.id === quiz.id) return;
      await sleep(100 * (i + 1));
    }
    throw new Error(
      "Викторина сохранена, но пока не читается. Попробуй ещё раз.",
    );
  }
  memory().quizzes[quiz.id] = quiz;
  const all = await readFileStore<Quiz>(QUIZZES_FILE);
  all[quiz.id] = quiz;
  await writeFileStore(QUIZZES_FILE, all);
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  requireStore();
  if (hasBlob()) {
    return blobGetJson<Quiz>(`quizzes/${id}.json`);
  }
  if (memory().quizzes[id]) return memory().quizzes[id];
  const all = await readFileStore<Quiz>(QUIZZES_FILE);
  if (all[id]) {
    memory().quizzes[id] = all[id];
    return all[id];
  }
  return null;
}

export async function getQuizQuestion(
  quizId: string,
  index: number,
): Promise<Question | null> {
  const quiz = await getQuiz(quizId);
  return quiz?.questions[index] ?? null;
}

export async function saveRoom(room: Room): Promise<void> {
  requireStore();
  if (hasBlob()) {
    await blobPutJson(`rooms/${room.code}.json`, room);
    for (let i = 0; i < 5; i++) {
      const got = await blobGetJson<Room>(`rooms/${room.code}.json`);
      if (got?.code === room.code) return;
      await sleep(100 * (i + 1));
    }
    throw new Error("Комната сохранена, но пока не читается. Попробуй ещё раз.");
  }
  memory().rooms[room.code] = room;
  const all = await readFileStore<Room>(ROOMS_FILE);
  all[room.code] = room;
  await writeFileStore(ROOMS_FILE, all);
}

export async function getRoom(code: string): Promise<Room | null> {
  requireStore();
  const key = code.toUpperCase();
  if (hasBlob()) {
    return blobGetJson<Room>(`rooms/${key}.json`);
  }
  if (memory().rooms[key]) return memory().rooms[key];
  const all = await readFileStore<Room>(ROOMS_FILE);
  if (all[key]) {
    memory().rooms[key] = all[key];
    return all[key];
  }
  return null;
}

export async function mutateRoom(
  code: string,
  mutator: (room: Room) => void,
): Promise<Room | null> {
  requireStore();
  const key = code.toUpperCase();

  for (let attempt = 0; attempt < 8; attempt++) {
    if (hasBlob()) {
      const room = await blobGetJson<Room & { _v?: number }>(
        `rooms/${key}.json`,
      );
      if (!room) return null;
      const version = room._v ?? 0;
      mutator(room);
      room._v = version + 1 + attempt;
      await blobPutJson(`rooms/${key}.json`, room);

      for (let i = 0; i < 5; i++) {
        const verify = await blobGetJson<Room & { _v?: number }>(
          `rooms/${key}.json`,
        );
        if (verify && (verify._v ?? 0) >= (room._v ?? 0)) return verify;
        await sleep(80 * (i + 1));
      }
      continue;
    }

    let room = memory().rooms[key];
    if (!room) {
      const all = await readFileStore<Room>(ROOMS_FILE);
      room = all[key];
      if (!room) return null;
      memory().rooms[key] = room;
    }
    const clone = structuredClone(room);
    mutator(clone);
    memory().rooms[key] = clone;
    const all = await readFileStore<Room>(ROOMS_FILE);
    all[key] = clone;
    await writeFileStore(ROOMS_FILE, all);
    return clone;
  }

  return null;
}
