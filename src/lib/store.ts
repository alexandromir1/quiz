import { Redis } from "@upstash/redis";
import { promises as fs } from "fs";
import path from "path";
import type { Question, QuestionMeta, Quiz, Room } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

const QUIZ_TTL = 60 * 60 * 24 * 14; // 14 days
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
      "Картинка слишком большая для хранилища. Попробуй другое фото или меньший файл.",
    );
    this.name = "StorageTooLargeError";
  }
}

type QuizMeta = {
  id: string;
  title: string;
  createdAt: number;
  hostSecret: string;
  questions: QuestionMeta[];
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
  return new Redis(creds);
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
  return /max request|too large|payload|Request failed|ERR max/i.test(msg);
}

async function redisSet(key: string, value: string, ex: number) {
  try {
    await redis().set(key, value, { ex });
  } catch (e) {
    if (isTooLargeError(e)) throw new StorageTooLargeError();
    throw e;
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
      questions: quiz.questions.map(({ id, answers, correctIndex }) => ({
        id,
        answers,
        correctIndex,
      })),
    };
    await redisSet(`quiz:${quiz.id}`, JSON.stringify(meta), QUIZ_TTL);
    for (const q of quiz.questions) {
      await redisSet(`quiz:${quiz.id}:img:${q.id}`, q.imageDataUrl, QUIZ_TTL);
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
      const img = await redis().get<string>(`quiz:${id}:img:${q.id}`);
      const imageDataUrl =
        typeof img === "string" ? img : img != null ? String(img) : "";
      questions.push({ ...q, imageDataUrl });
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
    const img = await redis().get<string>(`quiz:${quizId}:img:${q.id}`);
    const imageDataUrl =
      typeof img === "string" ? img : img != null ? String(img) : "";
    return { ...q, imageDataUrl };
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
      const raw = await r.get(redisKey);
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
        if (isTooLargeError(e)) throw new StorageTooLargeError();
        throw e;
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
