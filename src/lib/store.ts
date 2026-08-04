import { Redis } from "@upstash/redis";
import { promises as fs } from "fs";
import path from "path";
import type { Quiz, Room } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");

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

function hasRedis() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function redis() {
  return Redis.fromEnv();
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
redis.call("SET", KEYS[1], ARGV[2], "EX", 86400)
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

export async function saveQuiz(quiz: Quiz): Promise<void> {
  if (hasRedis()) {
    await redis().set(`quiz:${quiz.id}`, JSON.stringify(quiz));
    return;
  }
  memory().quizzes[quiz.id] = quiz;
  const all = await readFileStore<Quiz>(QUIZZES_FILE);
  all[quiz.id] = quiz;
  await writeFileStore(QUIZZES_FILE, all);
}

export async function getQuiz(id: string): Promise<Quiz | null> {
  if (hasRedis()) {
    const raw = await redis().get(`quiz:${id}`);
    return parseMaybeJson<Quiz>(raw);
  }
  if (memory().quizzes[id]) return memory().quizzes[id];
  const all = await readFileStore<Quiz>(QUIZZES_FILE);
  if (all[id]) {
    memory().quizzes[id] = all[id];
    return all[id];
  }
  return null;
}

export async function saveRoom(room: Room): Promise<void> {
  if (hasRedis()) {
    await redis().set(`room:${room.code}`, JSON.stringify(room), {
      ex: 60 * 60 * 24,
    });
    return;
  }
  memory().rooms[room.code] = room;
  const all = await readFileStore<Room>(ROOMS_FILE);
  all[room.code] = room;
  await writeFileStore(ROOMS_FILE, all);
}

export async function getRoom(code: string): Promise<Room | null> {
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

/** Apply a mutation with optimistic concurrency (safe for concurrent answers). */
export async function mutateRoom(
  code: string,
  mutator: (room: Room) => void,
): Promise<Room | null> {
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
      const ok = await r.eval(CAS_LUA, [redisKey], [prevStr, nextStr]);
      if (ok === 1) return room;
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
