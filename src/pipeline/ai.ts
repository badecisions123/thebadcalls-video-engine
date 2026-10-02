import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PixabayHit } from "./stock";

/**
 * Any OpenAI-compatible chat endpoint: Google Gemini, LM Studio, Groq,
 * OpenRouter, Ollama... They all accept POST {baseUrl}/chat/completions.
 */
export type AiConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Can the model look at images? Needed to check clip previews. */
  vision: boolean;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
};

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

/**
 * Reads the AI settings:
 * - AI_BASE_URL (+ AI_MODEL, optional AI_API_KEY) for any OpenAI-compatible server,
 *   e.g. LM Studio at http://localhost:1234/v1
 * - otherwise GEMINI_API_KEY (+ optional GEMINI_MODEL) for Google Gemini, or
 *   AI_PROVIDER=gemini when a proxy adds the key to requests itself
 * AI_VISION=false turns off preview checking for text-only models.
 * Returns undefined when nothing is configured.
 */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv): AiConfig | undefined {
  const vision = env.AI_VISION !== "false";
  if (env.AI_BASE_URL) {
    if (!env.AI_MODEL) throw new Error("AI_BASE_URL is set but AI_MODEL is not (use the model name your server shows)");
    return { baseUrl: env.AI_BASE_URL.replace(/\/+$/, ""), apiKey: env.AI_API_KEY, model: env.AI_MODEL, vision };
  }
  if (env.GEMINI_API_KEY || env.AI_PROVIDER?.toLowerCase() === "gemini") {
    return { baseUrl: GEMINI_BASE_URL, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL, vision };
  }
  return undefined;
}

type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
type Message = { role: "system" | "user"; content: Content };

/** Sends a chat request and returns the reply text. Replies are cached on disk by request. */
export async function chat(config: AiConfig, messages: Message[]): Promise<string> {
  const body = JSON.stringify({ model: config.model, messages, temperature: 0.2 });
  const cacheFile = config.cacheDir
    ? path.join(config.cacheDir, `${createHash("sha256").update(config.baseUrl + body).digest("hex").slice(0, 20)}.txt`)
    : undefined;
  if (cacheFile && existsSync(cacheFile)) return readFile(cacheFile, "utf8");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await (config.fetchImpl ?? fetch)(`${config.baseUrl}/chat/completions`, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI request to ${config.baseUrl} failed (${res.status} ${res.statusText}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (cacheFile && text) {
    await mkdir(config.cacheDir!, { recursive: true });
    await writeFile(cacheFile, text);
  }
  return text;
}

/** Pulls the first JSON object out of a reply (models often wrap it in ```json fences or prose). */
export function parseJsonReply<T>(text: string): T | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

const QUERY_PROMPT = `You are a video editor picking stock B-roll for a vertical short-form video.
The narration is below, split into numbered sentences. For each sentence, write 3 search queries for the Pixabay stock video library, best first.

Rules for queries:
- Describe what should be ON SCREEN while the sentence is spoken: concrete, filmable subjects and actions (people, places, objects).
- 1 to 3 words each, plain English, like "businessman laughing", "empty shopping mall", "stock market chart".
- Never use brand, company or person names (stock libraries don't have them): show the idea instead
  (a video rental chain -> "video rental store", "vhs tapes"; a streaming service -> "watching tv", "laptop streaming").
- Avoid abstract words ("success", "lesson", "threat") unless paired with something visible.
- Keep the whole video visually coherent: it tells one story.

Reply with JSON only, in this exact shape:
{"sentences": [{"i": 0, "queries": ["...", "...", "..."]}, ...]}`;

/** Asks the model for Pixabay searches for every sentence at once, so it sees the whole story. */
export async function suggestQueries(config: AiConfig, sentences: string[]): Promise<string[][]> {
  const numbered = sentences.map((s, i) => `${i}. ${s}`).join("\n");
  const reply = await chat(config, [
    { role: "system", content: QUERY_PROMPT },
    { role: "user", content: numbered },
  ]);
  const parsed = parseJsonReply<{ sentences?: { i?: number; queries?: unknown[] }[] }>(reply);
  const out: string[][] = sentences.map(() => []);
  for (const item of parsed?.sentences ?? []) {
    if (typeof item.i !== "number" || !out[item.i]) continue;
    out[item.i] = (item.queries ?? [])
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim().toLowerCase())
      .filter((q) => q && q.split(/\s+/).length <= 4)
      .slice(0, 3);
  }
  return out;
}

const PICK_PROMPT = `You are a video editor choosing background footage for a vertical short-form video.
You'll see one narration sentence and several numbered preview frames of candidate stock clips.
Choose the clips that fit as footage shown while that sentence is narrated: on-topic, believable, and not distracting.
Reject anything off-topic, cartoonish, low quality, or showing readable text/logos that contradict the story.

Reply with JSON only: {"good": [indexes of fitting clips, best first]} — an empty list if none fit.`;

/** Smallest preview image Pixabay offers for a hit. */
function thumbnailUrl(hit: PixabayHit): string | undefined {
  for (const size of ["tiny", "small", "medium", "large"] as const) {
    const t = (hit.videos[size] as { thumbnail?: string } | undefined)?.thumbnail;
    if (t) return t;
  }
  return undefined;
}

/**
 * Shows the model each candidate's preview frame and returns the ones it says
 * fit the sentence, best first. Candidates without a preview are dropped.
 */
export async function pickClips(config: AiConfig, sentence: string, hits: PixabayHit[]): Promise<PixabayHit[]> {
  const doFetch = config.fetchImpl ?? fetch;
  const withImages: { hit: PixabayHit; dataUrl: string }[] = [];
  for (const hit of hits) {
    const url = thumbnailUrl(hit);
    if (!url) continue;
    const res = await doFetch(url).catch(() => undefined);
    if (!res?.ok) continue;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    withImages.push({ hit, dataUrl: `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` });
  }
  if (!withImages.length) return [];

  const content: Content = [{ type: "text", text: `Sentence: "${sentence}"` }];
  withImages.forEach(({ dataUrl }, i) => {
    content.push({ type: "text", text: `Clip ${i}:` });
    content.push({ type: "image_url", image_url: { url: dataUrl } });
  });
  const reply = await chat(config, [
    { role: "system", content: PICK_PROMPT },
    { role: "user", content },
  ]);
  const good = parseJsonReply<{ good?: unknown[] }>(reply)?.good ?? [];
  return [...new Set(good)]
    .filter((i): i is number => typeof i === "number" && i >= 0 && i < withImages.length)
    .map((i) => withImages[i].hit);
}
