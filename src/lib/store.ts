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

type StoreShape = {
  quizzes: Record<string, Quiz>;
  rooms: Record<string, Room>;
};

const globalStore = globalThis as typeof globalThis & {
  __quizMemory?: StoreShape;
};

function memory(): StoreShape {
  if (!globalStore.__quizMemory) {
    globalStore.__quizMemory = { quizzes: {}, rooms: {} };
  }
  return globalStore.__quizMemory;
}

function isVercel() {
  return Boolean(process.env.VERCEL);
}

export function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Kept for /api/health compatibility */
export function hasRedis() {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

function requireStore() {
  if (hasBlob()) return;
  if (!isVercel()) return; // local file store
  throw new StorageNotConfiguredError();
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

async function blobPutJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function blobGetJson<T>(pathname: string): Promise<T | null> {
  const { blobs } = await list({ prefix: pathname, limit: 10 });
  const match = blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
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
    return;
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
    return;
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
      room._v = version + 1;

      // Re-read to reduce lost updates under concurrent answers
      const latest = await blobGetJson<Room & { _v?: number }>(
        `rooms/${key}.json`,
      );
      if (!latest) return null;
      if ((latest._v ?? 0) !== version) {
        continue;
      }
      await blobPutJson(`rooms/${key}.json`, room);
      return room;
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

// Legacy export so old imports don't break
export class StorageTooLargeError extends Error {
  constructor() {
    super("Хранилище отклонило данные. Попробуй ещё раз.");
    this.name = "StorageTooLargeError";
  }
}
