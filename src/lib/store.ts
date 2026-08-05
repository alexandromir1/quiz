import { list, put } from "@vercel/blob";
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
  __blobLatestUrl?: Map<string, string>;
};

function memory(): StoreShape {
  if (!globalStore.__quizMemory) {
    globalStore.__quizMemory = { quizzes: {}, rooms: {} };
  }
  return globalStore.__quizMemory;
}

function latestUrlCache() {
  if (!globalStore.__blobLatestUrl) {
    globalStore.__blobLatestUrl = new Map();
  }
  return globalStore.__blobLatestUrl;
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

/**
 * Blob CDN caches overwrites for ≥60s. So we never overwrite:
 * each write creates a new immutable object under a folder prefix,
 * and readers pick the newest by uploadedAt.
 */
async function blobPutJson(folder: string, data: unknown): Promise<string> {
  const pathname = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const result = await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  latestUrlCache().set(folder, result.url);
  return result.url;
}

async function blobGetJson<T>(folder: string): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Prefer same-isolate cache from the last write
      const cachedUrl = latestUrlCache().get(folder);
      if (cachedUrl) {
        const cachedRes = await fetch(cachedUrl, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
          },
        });
        if (cachedRes.ok) return (await cachedRes.json()) as T;
      }

      const listed = await list({ prefix: `${folder}/`, limit: 100 });
      if (listed.blobs.length === 0) {
        await sleep(100 * (attempt + 1));
        continue;
      }
      const newest = [...listed.blobs].sort(
        (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
      )[0];
      latestUrlCache().set(folder, newest.url);

      const res = await fetch(newest.url, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        },
      });
      if (res.status === 404) {
        await sleep(100 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Blob fetch ${res.status}`);
      return (await res.json()) as T;
    } catch {
      await sleep(120 * (attempt + 1));
    }
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
      const folder = `ping/${Date.now()}`;
      await blobPutJson(folder, { ok: true });
      const got = await blobGetJson<{ ok: boolean }>(folder);
      return {
        ok: got?.ok === true,
        latencyMs: Date.now() - started,
        storage: "blob-versioned",
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - started,
        storage: "blob-versioned",
      };
    }
  }
  return { ok: false, error: "blob_not_configured", storage: "none" };
}

export async function saveQuiz(quiz: Quiz): Promise<void> {
  requireStore();
  if (hasBlob()) {
    await blobPutJson(`quizzes/${quiz.id}`, quiz);
    for (let i = 0; i < 5; i++) {
      const got = await blobGetJson<Quiz>(`quizzes/${quiz.id}`);
      if (got?.id === quiz.id) return;
      await sleep(80 * (i + 1));
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
    return blobGetJson<Quiz>(`quizzes/${id}`);
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
    await blobPutJson(`rooms/${room.code}`, room);
    for (let i = 0; i < 5; i++) {
      const got = await blobGetJson<Room>(`rooms/${room.code}`);
      if (got?.code === room.code) return;
      await sleep(80 * (i + 1));
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
    return blobGetJson<Room>(`rooms/${key}`);
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
      const room = await blobGetJson<Room & { _v?: number }>(`rooms/${key}`);
      if (!room) return null;
      const version = room._v ?? 0;
      mutator(room);
      room._v = version + 1;
      await blobPutJson(`rooms/${key}`, room);

      for (let i = 0; i < 5; i++) {
        const verify = await blobGetJson<Room & { _v?: number }>(
          `rooms/${key}`,
        );
        if (verify && (verify._v ?? 0) >= (room._v ?? 0)) return verify;
        await sleep(60 * (i + 1));
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
