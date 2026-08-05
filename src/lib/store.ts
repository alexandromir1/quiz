import { Redis } from "@upstash/redis";
import { promises as fs } from "fs";
import path from "path";
import type { Question, QuestionMeta, Quiz, Room } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

const QUIZ_TTL = 60 * 60 * 24 * 7; // 7 days
const ROOM_TTL = 60 * 60 * 24;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "На Vercel нужно подключить Redis: в проекте открой Storage → Create → Upstash Redis (или KV). Переменные подставятся сами, затем сделай Redeploy.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

export class StorageTooLargeError extends Error {
  constructor() {
    super(
      "Картинка слишком большая для хранилища. Подключи Vercel Blob и заново выбери фото.",
    );
    this.name = "StorageTooLargeError";
  }
}

type StoredQuestion = QuestionMeta & {
  /** Present when image is a Blob/HTTPS URL (preferred). */
  imageUrl?: string;
};

type QuizMeta = {
  id: string;
  title: string;
  createdAt: number;
  hostSecret: string;
  questions: StoredQuestion[];
};

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

function redisCredentials(): { url: string; token: string } | null {
  const pairs: Array<[string | undefined, string | undefined]> = [
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN],
    [process.env.STORAGE_REST_API_URL, process.env.STORAGE_REST_API_TOKEN],
    [process.env.REDIS_REST_API_URL, process.env.REDIS_REST_API_TOKEN],
  ];
  for (const [url, token] of pairs) {
    if (url && token) return { url, token };
  }
  return null;
}

export function hasRedis() {
  return redisCredentials() != null;
}

function redis() {
  const creds = redisCredentials();
  if (!creds) throw new StorageNotConfiguredError();
  return new Redis({
    url: creds.url,
    token: creds.token,
  });
}

function requireStore() {
  if (hasRedis()) return;
  if (isVercel()) throw new StorageNotConfiguredError();
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

const CAS_LUA = `
local cur = redis.call("GET", KEYS[1])
if not cur then return 0 end
if cur ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`;

function parseMaybeJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as T;
  return null;
}

function isTooLargeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // Do NOT match generic "Request failed" — Upstash uses that for any error.
  return /max request size|too large|payload too large|ERR max|value is too large/i.test(
    msg,
  );
}

function wrapRedisError(e: unknown): never {
  if (isTooLargeError(e)) throw new StorageTooLargeError();
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(`Redis: ${msg.slice(0, 300)}`);
}

async function redisSet(key: string, value: string, ex: number) {
  try {
    await redis().set(key, value, { ex });
  } catch (e) {
    wrapRedisError(e);
  }
}

const CHUNK_CHARS = 40_000;

async function setLargeString(key: string, value: string, ex: number) {
  if (value.length <= CHUNK_CHARS) {
    await redisSet(key, value, ex);
    return;
  }

  const n = Math.ceil(value.length / CHUNK_CHARS);
  await redisSet(key, JSON.stringify({ __chunks: n }), ex);
  for (let i = 0; i < n; i++) {
    await redisSet(
      `${key}:${i}`,
      value.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
      ex,
    );
  }
}

async function getLargeString(key: string): Promise<string | null> {
  const raw = await redis().get(key);
  if (raw == null) return null;

  const asMeta = (v: unknown): number | null => {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v) as { __chunks?: number };
        return typeof parsed?.__chunks === "number" ? parsed.__chunks : null;
      } catch {
        return null;
      }
    }
    if (v && typeof v === "object" && "__chunks" in v) {
      const n = (v as { __chunks?: number }).__chunks;
      return typeof n === "number" ? n : null;
    }
    return null;
  };

  const chunks = asMeta(raw);
  if (chunks == null) {
    return typeof raw === "string" ? raw : String(raw);
  }

  const parts: string[] = [];
  for (let i = 0; i < chunks; i++) {
    const part = await redis().get(`${key}:${i}`);
    parts.push(typeof part === "string" ? part : String(part ?? ""));
  }
  return parts.join("");
}

export async function pingRedis(): Promise<{
  ok: boolean;
  error?: string;
  latencyMs?: number;
}> {
  if (!hasRedis()) return { ok: false, error: "not_configured" };
  const started = Date.now();
  try {
    const key = `ping:${Date.now()}`;
    await redis().set(key, "ok", { ex: 30 });
    const val = await redis().get(key);
    await redis().del(key);
    return { ok: val === "ok" || val === '"ok"', latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - started,
    };
  }
}

export async function saveQuiz(quiz: Quiz): Promise<void> {
  requireStore();
  if (hasRedis()) {
    const meta: QuizMeta = {
      id: quiz.id,
      title: quiz.title,
      createdAt: quiz.createdAt,
      hostSecret: quiz.hostSecret,
      questions: quiz.questions.map((q) => {
        const base: StoredQuestion = {
          id: q.id,
          answers: q.answers,
          correctIndex: q.correctIndex,
        };
        // HTTPS Blob URLs live in meta (tiny). Avoid separate Redis image keys.
        if (q.imageDataUrl.startsWith("https://")) {
          base.imageUrl = q.imageDataUrl;
        }
        return base;
      }),
    };

    await redisSet(`quiz:${quiz.id}`, JSON.stringify(meta), QUIZ_TTL);

    // Only legacy/local data-URLs need chunked image keys
    for (const q of quiz.questions) {
      if (q.imageDataUrl.startsWith("https://")) continue;
      await setLargeString(
        `quiz:${quiz.id}:img:${q.id}`,
        q.imageDataUrl,
        QUIZ_TTL,
      );
    }
    return;
  }
  memory().quizzes[quiz.id] = quiz;
  const all = await readFileStore<Quiz>(QUIZZES_FILE);
  all[quiz.id] = quiz;
  await writeFileStore(QUIZZES_FILE, all);
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  requireStore();
  if (hasRedis()) {
    const raw = await redis().get(`quiz:${id}`);
    const meta = parseMaybeJson<QuizMeta>(raw);
    if (!meta) return null;
    const questions: Question[] = [];
    for (const q of meta.questions) {
      let imageDataUrl = q.imageUrl ?? "";
      if (!imageDataUrl) {
        imageDataUrl = (await getLargeString(`quiz:${id}:img:${q.id}`)) ?? "";
      }
      questions.push({
        id: q.id,
        answers: q.answers,
        correctIndex: q.correctIndex,
        imageDataUrl,
      });
    }
    return {
      id: meta.id,
      title: meta.title,
      createdAt: meta.createdAt,
      hostSecret: meta.hostSecret,
      questions,
    };
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
  requireStore();
  if (hasRedis()) {
    const raw = await redis().get(`quiz:${quizId}`);
    const meta = parseMaybeJson<QuizMeta>(raw);
    if (!meta) return null;
    const q = meta.questions[index];
    if (!q) return null;
    let imageDataUrl = q.imageUrl ?? "";
    if (!imageDataUrl) {
      imageDataUrl =
        (await getLargeString(`quiz:${quizId}:img:${q.id}`)) ?? "";
    }
    return {
      id: q.id,
      answers: q.answers,
      correctIndex: q.correctIndex,
      imageDataUrl,
    };
  }
  const quiz = await getQuiz(quizId);
  return quiz?.questions[index] ?? null;
}

export async function saveRoom(room: Room): Promise<void> {
  requireStore();
  if (hasRedis()) {
    await redisSet(`room:${room.code}`, JSON.stringify(room), ROOM_TTL);
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
  if (hasRedis()) {
    const raw = await redis().get(`room:${key}`);
    return parseMaybeJson<Room>(raw);
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

  for (let attempt = 0; attempt < 12; attempt++) {
    if (hasRedis()) {
      const r = redis();
      const redisKey = `room:${key}`;
      let raw: unknown;
      try {
        raw = await r.get(redisKey);
      } catch (e) {
        wrapRedisError(e);
      }
      if (raw == null) return null;

      const prevStr = typeof raw === "string" ? raw : JSON.stringify(raw);
      const room = parseMaybeJson<Room>(raw);
      if (!room) return null;

      mutator(room);
      const nextStr = JSON.stringify(room);
      try {
        const ok = await r.eval(
          CAS_LUA,
          [redisKey],
          [prevStr, nextStr, String(ROOM_TTL)],
        );
        if (ok === 1) return room;
      } catch (e) {
        wrapRedisError(e);
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
