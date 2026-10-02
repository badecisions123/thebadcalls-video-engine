import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type AiConfig, aiConfigFromEnv, parseJsonReply, pickClips, suggestQueries } from "./ai";
import type { PixabayHit } from "./stock";

const hit = (id: number): PixabayHit => ({
  id,
  pageURL: `https://pixabay.com/videos/${id}/`,
  tags: "test",
  duration: 10,
  videos: { tiny: { url: `https://cdn.pixabay.com/${id}.mp4`, width: 1280, height: 720, size: 1, thumbnail: `https://cdn.pixabay.com/${id}.jpg` } },
});

/** Fake OpenAI-compatible server: records requests and answers with `reply`. */
function fakeAi(reply: string) {
  const requests: { url: string; auth: string | null; body: any }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".jpg")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    requests.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  }) as typeof fetch;
  return { requests, fetchImpl };
}

test("aiConfigFromEnv: Gemini by key, any OpenAI-compatible server by URL, nothing otherwise", () => {
  assert.equal(aiConfigFromEnv({}), undefined);
  const gemini = aiConfigFromEnv({ GEMINI_API_KEY: "g" })!;
  assert.match(gemini.baseUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(gemini.apiKey, "g");
  const local = aiConfigFromEnv({ AI_BASE_URL: "http://localhost:1234/v1/", AI_MODEL: "qwen", AI_VISION: "false", GEMINI_API_KEY: "g" })!;
  assert.deepEqual([local.baseUrl, local.model, local.apiKey, local.vision], ["http://localhost:1234/v1", "qwen", undefined, false]);
  assert.throws(() => aiConfigFromEnv({ AI_BASE_URL: "http://localhost:1234/v1" }), /AI_MODEL/);
});

test("parseJsonReply finds JSON inside code fences and prose", () => {
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"good": [1]}\n```'), { good: [1] });
  assert.equal(parseJsonReply("no json here"), undefined);
});

test("suggestQueries sends numbered sentences and cleans the reply", async () => {
  const { requests, fetchImpl } = fakeAi(
    '```json\n{"sentences": [{"i": 0, "queries": ["Video Rental Store", "vhs tapes", "x", "too many"]}, {"i": 5, "queries": ["ignored"]}]}\n```',
  );
  const config: AiConfig = { baseUrl: "http://ai", apiKey: "k", model: "m", vision: true, fetchImpl };
  const out = await suggestQueries(config, ["Blockbuster was huge.", "Then it failed."]);
  assert.deepEqual(out, [["video rental store", "vhs tapes", "x"], []]);
  assert.equal(requests[0].url, "http://ai/chat/completions");
  assert.equal(requests[0].auth, "Bearer k");
  assert.match(requests[0].body.messages[1].content, /0\. Blockbuster was huge\.\n1\. Then it failed\./);
});

test("pickClips shows previews and returns the chosen clips in order, ignoring bad indexes", async () => {
  const { requests, fetchImpl } = fakeAi('{"good": [2, 0, 9, 0]}');
  const picked = await pickClips({ baseUrl: "http://ai", model: "m", vision: true, fetchImpl }, "A sentence.", [hit(1), hit(2), hit(3)]);
  assert.deepEqual(picked.map((h) => h.id), [3, 1]);
  const images = requests[0].body.messages[1].content.filter((c: any) => c.type === "image_url");
  assert.equal(images.length, 3);
  assert.match(images[0].image_url.url, /^data:image\/jpeg;base64,/);
});

test("replies are cached so re-renders don't repeat AI calls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ai-"));
  try {
    const { requests, fetchImpl } = fakeAi('{"sentences": [{"i": 0, "queries": ["office"]}]}');
    const config: AiConfig = { baseUrl: "http://ai", model: "m", vision: false, cacheDir: dir, fetchImpl };
    await suggestQueries(config, ["Work."]);
    await suggestQueries(config, ["Work."]);
    assert.equal(requests.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
