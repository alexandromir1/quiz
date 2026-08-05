/**
 * Full multiplayer cycle against a running base URL (local or Vercel).
 * Usage: BASE_URL=https://quiz-topaz-eight.vercel.app node scripts/e2e-cycle.mjs
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ok(name, detail = "") {
  console.log(`PASS | ${name}${detail ? " — " + detail : ""}`);
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, json, text };
}

function tinyJpeg() {
  const b64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACEQMRAD8A/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
  return Buffer.from(b64, "base64");
}

async function uploadImage() {
  const form = new FormData();
  form.append(
    "file",
    new Blob([tinyJpeg()], { type: "image/jpeg" }),
    "q.jpg",
  );
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  const data = await res.json();
  assert(res.ok && data.url?.startsWith("https://"), `upload failed: ${JSON.stringify(data)}`);
  return data.url;
}

async function main() {
  console.log("E2E against", BASE);

  const health = await req("/api/health");
  assert(health.status === 200, `health ${health.status}`);
  assert(health.json?.blob === true, "blob must be enabled");
  assert(health.json?.storagePing?.ok === true, `storagePing failed: ${JSON.stringify(health.json?.storagePing)}`);
  ok("health + blob storage", `${health.json.storagePing.latencyMs}ms`);

  const urls = [];
  for (let i = 0; i < 2; i++) urls.push(await uploadImage());
  ok("upload 2 images");

  const created = await req("/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      title: `E2E ${Date.now()}`,
      questions: urls.map((u, i) => ({
        imageDataUrl: u,
        answers: ["A", "B", "C", "D"],
        correctIndex: i % 4,
      })),
    }),
  });
  assert(created.status === 200 && created.json?.id, `create quiz: ${created.text}`);
  assert(!String(created.json.id).includes("_"), "quiz id must not contain underscore");
  ok("create quiz", created.json.id);

  const got = await req(`/api/quizzes/${created.json.id}`);
  assert(got.status === 200, `get quiz immediately: ${got.status} ${got.text}`);
  assert(got.json.questionCount === 2, "question count");
  ok("get quiz right after create");

  const roomRes = await req("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      quizId: created.json.id,
      hostSecret: created.json.hostSecret,
      timeLimitSec: 20,
    }),
  });
  assert(roomRes.status === 200 && roomRes.json?.code, `create room: ${roomRes.text}`);
  const code = roomRes.json.code;
  ok("create room", code);

  const lobby = await req(`/api/rooms/${code}`);
  assert(lobby.status === 200 && lobby.json.phase === "lobby", `lobby: ${lobby.text}`);
  ok("read lobby");

  const p1 = await req(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Аня" }),
  });
  const p2 = await req(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name: "Боря" }),
  });
  assert(p1.status === 200 && p1.json.playerId, `join1: ${p1.text}`);
  assert(p2.status === 200 && p2.json.playerId, `join2: ${p2.text}`);
  ok("two players joined");

  const start = await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "start",
    }),
  });
  assert(start.status === 200 && start.json.phase === "question", `start: ${start.text}`);
  assert(start.json.currentQuestion?.answers?.length === 4, "question payload");
  assert(
    !("correctIndex" in (start.json.currentQuestion || {})),
    "correctIndex must be hidden during question",
  );
  ok("start question");

  await new Promise((r) => setTimeout(r, 300));

  const a1 = await req(`/api/rooms/${code}/answer`, {
    method: "POST",
    body: JSON.stringify({ playerId: p1.json.playerId, answerIndex: 0 }),
  });
  assert(a1.status === 200 && a1.json.correct === true, `answer1: ${a1.text}`);
  assert(a1.json.points >= 500 && a1.json.points <= 1000, `points1 ${a1.json.points}`);
  ok("player1 correct fast-ish", `${a1.json.points} pts`);

  await new Promise((r) => setTimeout(r, 1200));

  const a2 = await req(`/api/rooms/${code}/answer`, {
    method: "POST",
    body: JSON.stringify({ playerId: p2.json.playerId, answerIndex: 1 }),
  });
  // Retry once if storage lag
  let a2final = a2;
  if (a2.status !== 200) {
    await new Promise((r) => setTimeout(r, 400));
    a2final = await req(`/api/rooms/${code}/answer`, {
      method: "POST",
      body: JSON.stringify({ playerId: p2.json.playerId, answerIndex: 1 }),
    });
  }
  assert(a2final.status === 200 && a2final.json.correct === false && a2final.json.points === 0, `answer2: ${a2final.text}`);
  ok("player2 wrong = 0");

  const reveal = await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "reveal",
    }),
  });
  assert(reveal.status === 200 && reveal.json.phase === "reveal", `reveal: ${reveal.text}`);
  assert(reveal.json.currentQuestion?.correctIndex === 0, "correct shown");
  ok("reveal");

  await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "leaderboard",
    }),
  });
  const board = await req(`/api/rooms/${code}`);
  const sorted = [...board.json.players].sort((a, b) => b.score - a.score);
  assert(sorted[0].name === "Аня" && sorted[0].score === a1.json.points, "leaderboard order");
  ok("leaderboard");

  const next = await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "next",
    }),
  });
  assert(next.status === 200 && next.json.phase === "question" && next.json.questionIndex === 1, `next: ${next.text}`);
  ok("question 2");

  await req(`/api/rooms/${code}/answer`, {
    method: "POST",
    body: JSON.stringify({ playerId: p1.json.playerId, answerIndex: 1 }),
  });
  await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "reveal",
    }),
  });
  const fin = await req(`/api/rooms/${code}/action`, {
    method: "POST",
    body: JSON.stringify({
      hostSecret: roomRes.json.hostSecret,
      action: "next",
    }),
  });
  assert(fin.status === 200 && fin.json.phase === "finished", `finish: ${fin.text}`);
  ok("finished");

  console.log("\nALL E2E CHECKS PASSED");
}

main().catch((e) => {
  console.error("\nE2E FAILED:", e.message || e);
  process.exit(1);
});
