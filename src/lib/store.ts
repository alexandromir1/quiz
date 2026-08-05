import { Redis } from "@upstash/redis";
import { get, list, put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";
import type { Question, Quiz, Room } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

const QUIZ_TTL_SEC = 60 * 60 * 24 * 7;
const ROOM_TTL_SEC = 60 * 60 * 12;
const REDIS_TIMEOUT_MS = 1200;
const REDIS_COOLDOWN_MS = 60_000;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Нужно подключить хранилище: Vercel Blob и/или Upstash Redis (KV), затем Redeploy.",
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
  __blobData?: Map<string, unknown>;
  __blobPath?: Map<string, string>;
  __redis?: Redis | null;
  __redisDeadUntil?: number;
};

function memory(): StoreShape {
  if (!globalStore.__quizMemory) {
    globalStore.__quizMemory = { quizzes: {}, rooms: {} };
  }
  return globalStore.__quizMemory;
}

function blobDataCache() {
  if (!globalStore.__blobData) globalStore.__blobData = new Map();
  return globalStore.__blobData;
}

function blobPathCache() {
  if (!globalStore.__blobPath) globalStore.__blobPath = new Map();
  return globalStore.__blobPath;
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
  if (hasRedis() || hasBlob()) return;
  if (!isVercel()) return;
  throw new StorageNotConfiguredError();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function redisClient(): Redis | null {
  if (!hasRedis()) return null;
  if (globalStore.__redis !== undefined) return globalStore.__redis;
  try {
    const url =
      process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token =
      process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      globalStore.__redis = null;
      return null;
    }
    globalStore.__redis = new Redis({ url, token });
    return globalStore.__redis;
  } catch {
    globalStore.__redis = null;
    return null;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timeout after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

/** Prefer Redis (fast, consistent). Fall back to Blob with immutable versions. */
function redisAvailable() {
  return Date.now() >= (globalStore.__redisDeadUntil ?? 0);
}

function markRedisDead() {
  globalStore.__redisDeadUntil = Date.now() + REDIS_COOLDOWN_MS;
}

async function redisGet<T>(key: string): Promise<T | null> {
  const redis = redisClient();
  if (!redis || !redisAvailable()) return null;
  try {
    const value = await withTimeout(
      redis.get<T>(key),
      REDIS_TIMEOUT_MS,
      "redis get",
    );
    return value ?? null;
  } catch {
    markRedisDead();
    return null;
  }
}

async function redisSet(key: string, value: unknown, ttlSec: number) {
  const redis = redisClient();
  if (!redis || !redisAvailable()) return false;
  try {
    await withTimeout(
      redis.set(key, value, { ex: ttlSec }),
      REDIS_TIMEOUT_MS,
      "redis set",
    );
    return true;
  } catch {
    markRedisDead();
    return false;
  }
}

async function listAllBlobs(prefix: string) {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
    });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function blobPutJson(folder: string, data: unknown): Promise<string> {
  const pathname = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  blobPathCache().set(folder, pathname);
  blobDataCache().set(folder, data);
  return pathname;
}

async function blobGetJson<T>(folder: string): Promise<T | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      // Always list — path cache from this isolate can be older than another writer's blob
      const listed = await listAllBlobs(`${folder}/`);
      if (listed.length === 0) {
        const knownPath = blobPathCache().get(folder);
        if (knownPath) {
          const direct = await get(knownPath, { access: "public" });
          if (direct?.stream) {
            const parsed = JSON.parse(await streamToText(direct.stream)) as T;
            blobDataCache().set(folder, parsed);
            return parsed;
          }
        }
        await sleep(120 * (attempt + 1));
        continue;
      }

      const newest = [...listed].sort(
        (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
      )[0];
      blobPathCache().set(folder, newest.pathname);

      const result = await get(newest.pathname, { access: "public" });
      if (!result?.stream) {
        await sleep(120 * (attempt + 1));
        continue;
      }
      const parsed = JSON.parse(await streamToText(result.stream)) as T;
      blobDataCache().set(folder, parsed);

      const stale = listed
        .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
        .slice(8);
      if (stale.length > 0) {
        void import("@vercel/blob").then(({ del }) =>
          del(stale.map((b) => b.url)).catch(() => undefined),
        );
      }

      return parsed;
    } catch {
      await sleep(150 * (attempt + 1));
    }
  }
  return null;
}

function quizKey(id: string) {
  return `quiz:${id}`;
}

function roomKey(code: string) {
  return `room:${code.toUpperCase()}`;
}

export async function pingStorage(): Promise<{
  ok: boolean;
  error?: string;
  latencyMs?: number;
  storage?: string;
  redisOk?: boolean;
  blobOk?: boolean;
}> {
  const started = Date.now();
  let redisOk = false;
  let blobOk = false;
  const errors: string[] = [];

  if (hasRedis()) {
    const probe = `ping:${Date.now()}`;
    const wrote = await redisSet(probe, { ok: true }, 60);
    if (wrote) {
      const got = await redisGet<{ ok: boolean }>(probe);
      redisOk = got?.ok === true;
      if (!redisOk) errors.push("redis_read_miss");
    } else {
      errors.push("redis_write_failed");
    }
  }

  if (hasBlob()) {
    try {
      const folder = `ping/${Date.now()}`;
      await blobPutJson(folder, { ok: true });
      // Bypass memory to verify network read path for other isolates
      blobDataCache().delete(folder);
      blobPathCache().delete(folder);
      const got = await blobGetJson<{ ok: boolean }>(folder);
      blobOk = got?.ok === true;
      if (!blobOk) errors.push("blob_read_miss");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const storage = redisOk ? "redis" : blobOk ? "blob-versioned" : "none";
  return {
    ok: redisOk || blobOk,
    redisOk,
    blobOk,
    storage,
    latencyMs: Date.now() - started,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

/** @deprecated use pingStorage */
export async function pingRedis() {
  return pingStorage();
}

export async function saveQuiz(quiz: Quiz): Promise<void> {
  requireStore();
  memory().quizzes[quiz.id] = quiz;

  const redisOk = await redisSet(quizKey(quiz.id), quiz, QUIZ_TTL_SEC);

  if (hasBlob()) {
    await blobPutJson(`quizzes/${quiz.id}`, quiz);
  }

  if (redisOk || blobDataCache().has(`quizzes/${quiz.id}`)) return;

  if (!isVercel()) {
    const all = await readFileStore<Quiz>(QUIZZES_FILE);
    all[quiz.id] = quiz;
    await writeFileStore(QUIZZES_FILE, all);
    return;
  }

  throw new Error(
    "Викторина сохранена, но пока не читается. Попробуй ещё раз.",
  );
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  requireStore();

  const fromRedis = await redisGet<Quiz>(quizKey(id));
  if (fromRedis) {
    memory().quizzes[id] = fromRedis;
    return fromRedis;
  }

  if (hasBlob()) {
    const fromBlob = await blobGetJson<Quiz>(`quizzes/${id}`);
    if (fromBlob) {
      memory().quizzes[id] = fromBlob;
      void redisSet(quizKey(id), fromBlob, QUIZ_TTL_SEC);
      return fromBlob;
    }
  }

  if (memory().quizzes[id]) return memory().quizzes[id];

  if (!isVercel()) {
    const all = await readFileStore<Quiz>(QUIZZES_FILE);
    if (all[id]) {
      memory().quizzes[id] = all[id];
      return all[id];
    }
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
  const key = room.code.toUpperCase();
  room.code = key;
  memory().rooms[key] = room;

  const redisOk = await redisSet(roomKey(key), room, ROOM_TTL_SEC);

  if (hasBlob()) {
    await blobPutJson(`rooms/${key}`, room);
  }

  if (redisOk || blobDataCache().has(`rooms/${key}`)) return;

  if (!isVercel()) {
    const all = await readFileStore<Room>(ROOMS_FILE);
    all[key] = room;
    await writeFileStore(ROOMS_FILE, all);
    return;
  }

  throw new Error("Комната сохранена, но пока не читается. Попробуй ещё раз.");
}

export async function getRoom(code: string): Promise<Room | null> {
  requireStore();
  const key = code.toUpperCase();

  const fromRedis = await redisGet<Room>(roomKey(key));
  if (fromRedis) {
    memory().rooms[key] = fromRedis;
    return fromRedis;
  }

  if (hasBlob()) {
    // Always list newest — never sticky memory (host/player are different isolates)
    const fromBlob = await blobGetJson<Room>(`rooms/${key}`);
    if (fromBlob) {
      memory().rooms[key] = fromBlob;
      void redisSet(roomKey(key), fromBlob, ROOM_TTL_SEC);
      return fromBlob;
    }
  }

  if (memory().rooms[key]) return memory().rooms[key];

  if (!isVercel()) {
    const all = await readFileStore<Room>(ROOMS_FILE);
    if (all[key]) {
      memory().rooms[key] = all[key];
      return all[key];
    }
  }
  return null;
}

function roomVersion(room: Room): number {
  return (room as Room & { _v?: number })._v ?? 0;
}

/** Merge concurrent room writes so answer/reveal don't wipe each other. */
function mergeRooms(
  base: Room & { _v?: number },
  incoming: Room & { _v?: number },
): Room & { _v?: number } {
  const phaseRank: Record<Room["phase"], number> = {
    lobby: 0,
    question: 1,
    reveal: 2,
    leaderboard: 3,
    finished: 4,
  };

  const out = structuredClone(base) as Room & { _v?: number };

  // Prefer further-along phase; keep matching question index from the further phase
  if (phaseRank[incoming.phase] > phaseRank[out.phase]) {
    out.phase = incoming.phase;
    out.questionIndex = incoming.questionIndex;
    out.questionStartedAt = incoming.questionStartedAt;
  } else if (
    phaseRank[incoming.phase] === phaseRank[out.phase] &&
    incoming.questionIndex > out.questionIndex
  ) {
    out.questionIndex = incoming.questionIndex;
    out.questionStartedAt = incoming.questionStartedAt;
    out.phase = incoming.phase;
  }

  const byId = new Map(out.players.map((p) => [p.id, p]));
  for (const p of incoming.players) {
    const existing = byId.get(p.id);
    if (!existing) {
      byId.set(p.id, structuredClone(p));
      continue;
    }
    existing.name = p.name || existing.name;
    existing.answers = { ...existing.answers, ...p.answers };
    existing.score = Object.values(existing.answers).reduce(
      (sum, a) => sum + a.points,
      0,
    );
  }
  out.players = [...byId.values()];
  out._v = Math.max(roomVersion(base), roomVersion(incoming)) + 1;
  return out;
}

export async function mutateRoom(
  code: string,
  mutator: (room: Room) => void,
): Promise<Room | null> {
  requireStore();
  const key = code.toUpperCase();

  for (let attempt = 0; attempt < 12; attempt++) {
    const room = await getRoom(key);
    if (!room) return null;

    const version = roomVersion(room);
    const clone = structuredClone(room) as Room & { _v?: number };
    mutator(clone);
    clone._v = version + 1;
    clone.code = key;

    try {
      const redisOk = await redisSet(roomKey(key), clone, ROOM_TTL_SEC);
      if (hasBlob()) {
        await blobPutJson(`rooms/${key}`, clone);
      }

      if (redisOk || hasBlob()) {
        memory().rooms[key] = clone;

        // Detect lost race: a newer blob may have overwritten without our changes
        await sleep(40);
        blobDataCache().delete(`rooms/${key}`);
        const latest = await getRoom(key);
        if (!latest) return clone;

        if (roomVersion(latest) <= roomVersion(clone)) {
          return latest;
        }

        // Newer version won the race — merge both and write once more
        const merged = mergeRooms(
          latest as Room & { _v?: number },
          clone,
        );
        memory().rooms[key] = merged;
        await redisSet(roomKey(key), merged, ROOM_TTL_SEC);
        if (hasBlob()) await blobPutJson(`rooms/${key}`, merged);
        return merged;
      }

      if (!isVercel()) {
        memory().rooms[key] = clone;
        const all = await readFileStore<Room>(ROOMS_FILE);
        all[key] = clone;
        await writeFileStore(ROOMS_FILE, all);
        return clone;
      }
    } catch {
      await sleep(100 * (attempt + 1));
      continue;
    }

    await sleep(80 * (attempt + 1));
  }

  return null;
}
