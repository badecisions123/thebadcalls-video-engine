import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.elevenlabs.io/v1";

/** Character-level timing returned by ElevenLabs' `/with-timestamps` endpoint. */
export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type VoiceoverOptions = {
  text: string;
  voiceId: string;
  modelId: string;
  outDir: string;
  apiKey?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
};

export type Voiceover = {
  audioPath: string;
  alignment: Alignment;
  /** True when the result came from the on-disk cache instead of the API. */
  cached: boolean;
};

type TimestampsResponse = {
  audio_base64: string;
  alignment: Alignment | null;
  normalized_alignment: Alignment | null;
};

/**
 * Generates a voiceover with ElevenLabs and returns the MP3 path plus
 * character-level alignment (used to build captions without a separate
 * transcription step).
 *
 * Results are cached in `outDir` keyed by text + voice settings, so re-running
 * a render after tweaking B-roll or caption styling doesn't spend credits.
 */
export async function generateVoiceover(opts: VoiceoverOptions): Promise<Voiceover> {
  const body = {
    text: opts.text,
    model_id: opts.modelId,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
      style: opts.style ?? 0,
      speed: opts.speed ?? 1,
    },
  };

  const key = createHash("sha256")
    .update(JSON.stringify({ voiceId: opts.voiceId, ...body }))
    .digest("hex")
    .slice(0, 16);
  await mkdir(opts.outDir, { recursive: true });
  const audioPath = path.join(opts.outDir, `voiceover-${key}.mp3`);
  const alignmentPath = path.join(opts.outDir, `voiceover-${key}.alignment.json`);

  if (existsSync(audioPath) && existsSync(alignmentPath)) {
    const alignment = JSON.parse(await readFile(alignmentPath, "utf8")) as Alignment;
    return { audioPath, alignment, cached: true };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (opts.apiKey) headers["xi-api-key"] = opts.apiKey;

  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status} ${res.statusText}): ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as TimestampsResponse;
  // Prefer alignment against the original text so captions match the script's
  // spelling and punctuation; fall back to the normalized one.
  const alignment = data.alignment ?? data.normalized_alignment;
  if (!data.audio_base64 || !alignment) {
    throw new Error("ElevenLabs response did not include audio and alignment data");
  }

  await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));
  await writeFile(alignmentPath, JSON.stringify(alignment));
  return { audioPath, alignment, cached: false };
}
