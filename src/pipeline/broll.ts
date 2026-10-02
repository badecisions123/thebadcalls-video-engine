import { readdir } from "node:fs/promises";
import path from "node:path";
import { getVideoMetadata } from "@remotion/renderer";
import type { Shot } from "../types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export type SourceClip = {
  /** Absolute path on disk. */
  file: string;
  durationInSeconds: number;
};

/** Lists video files in `dir` in natural order (clip2 before clip10) with their durations. */
export async function listClips(dir: string): Promise<SourceClip[]> {
  const names = (await readdir(dir))
    .filter((n) => !n.startsWith(".") && VIDEO_EXTENSIONS.has(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  return measureClips(names.map((name) => path.resolve(dir, name)));
}

/** Reads each file's duration, skipping (with a warning) any that can't be read. */
export async function measureClips(files: string[]): Promise<SourceClip[]> {
  const clips: SourceClip[] = [];
  for (const file of files) {
    const meta = await getVideoMetadata(file, { logLevel: "error" }).catch(() => null);
    if (!meta?.durationInSeconds || meta.durationInSeconds <= 0) {
      console.warn(`  ! Skipping ${path.basename(file)}: could not determine duration`);
      continue;
    }
    clips.push({ file: path.resolve(file), durationInSeconds: meta.durationInSeconds });
  }
  return clips;
}

export type PlanOptions = {
  fps: number;
  /** Shortest shot we'll create unless a clip itself is shorter (seconds). */
  minShot: number;
  /** Preferred shot length when there's no nearby sentence boundary (seconds). */
  targetShot: number;
  /** Longest a single shot may run before cutting to the next clip (seconds). */
  maxShot: number;
};

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  fps: 30,
  minShot: 1.5,
  targetShot: 3,
  maxShot: 5,
};

/**
 * Lays clips end-to-end (looping through the folder if needed) to cover
 * `totalFrames`. Cuts are snapped to `cutPoints` (sentence/clause boundaries
 * from the captions) when one falls within the allowed shot length, so scene
 * changes land on the beat of the voiceover.
 *
 * `clips[i].src` is what ends up in the composition (a staticFile path).
 */
export function planShots(
  clips: { src: string; durationInSeconds: number }[],
  totalFrames: number,
  cutPointsSeconds: number[],
  options: Partial<PlanOptions> = {},
): Shot[] {
  if (!clips.length) throw new Error("No B-roll clips to plan with");
  const opts = { ...DEFAULT_PLAN_OPTIONS, ...options };
  const f = (s: number) => Math.round(s * opts.fps);
  const minF = Math.max(1, f(opts.minShot));
  const maxF = Math.max(minF, f(opts.maxShot));
  const targetF = Math.min(maxF, Math.max(minF, f(opts.targetShot)));
  const cuts = cutPointsSeconds.map(f).sort((a, b) => a - b);

  const shots: Shot[] = [];
  let t = 0;
  let i = 0;
  while (t < totalFrames) {
    const clip = clips[i % clips.length];
    const pass = Math.floor(i / clips.length);
    const clipF = Math.max(1, Math.floor(clip.durationInSeconds * opts.fps));
    const longest = Math.min(clipF, maxF);
    const shortest = Math.min(clipF, minF);
    const remaining = totalFrames - t;

    let len: number;
    if (remaining <= longest) {
      len = remaining;
    } else {
      const ideal = Math.min(targetF, longest);
      const candidates = cuts.filter((c) => c - t >= shortest && c - t <= longest);
      len = candidates.length
        ? candidates.reduce((best, c) => (Math.abs(c - t - ideal) < Math.abs(best - t - ideal) ? c : best)) - t
        : ideal;
      // Don't strand a tiny shot at the very end; shorten this one instead.
      const tail = remaining - len;
      if (tail > 0 && tail < minF && remaining - minF >= shortest) len = remaining - minF;
    }

    // On repeat passes through the folder, start later in the clip so loops look less obvious.
    const slack = clipF - len;
    const trimBefore = pass > 0 && slack > 0 ? Math.floor((slack * pass) / (pass + 1)) : 0;

    shots.push({ src: clip.src, from: t, durationInFrames: len, trimBefore });
    t += len;
    i++;
  }
  return shots;
}

export type SegmentPlan = {
  /** Seconds; segments should be contiguous and cover the whole timeline. */
  start: number;
  end: number;
  clips: { src: string; durationInSeconds: number }[];
};

/**
 * Plans each segment on its own with planShots(), so the footage matched to a
 * sentence plays while that sentence is spoken. The last segment runs to `totalFrames`.
 */
export function planSegmentedShots(
  segments: SegmentPlan[],
  totalFrames: number,
  cutPointsSeconds: number[],
  options: Partial<PlanOptions> = {},
): Shot[] {
  const fps = options.fps ?? DEFAULT_PLAN_OPTIONS.fps;
  const shots: Shot[] = [];
  segments.forEach((seg, i) => {
    const from = i === 0 ? 0 : Math.round(seg.start * fps);
    const to = i === segments.length - 1 ? totalFrames : Math.round(seg.end * fps);
    if (to <= from) return;
    // Cut points relative to this segment (excluding its own edges).
    const cuts = cutPointsSeconds.map((c) => c - from / fps).filter((c) => c > 0 && c < (to - from) / fps);
    for (const shot of planShots(seg.clips, to - from, cuts, options)) {
      shots.push({ ...shot, from: shot.from + from });
    }
  });
  return shots;
}

/**
 * Hands the time of segments that have no clips to a neighbour: to the
 * previous segment, or to the next one for a leading empty segment.
 */
export function mergeEmptySegments(segments: SegmentPlan[]): SegmentPlan[] {
  const out: SegmentPlan[] = [];
  let pendingStart: number | undefined;
  for (const seg of segments) {
    if (!seg.clips.length) {
      if (out.length) out[out.length - 1] = { ...out[out.length - 1], end: seg.end };
      else pendingStart ??= seg.start;
      continue;
    }
    out.push(pendingStart === undefined ? seg : { ...seg, start: pendingStart });
    pendingStart = undefined;
  }
  return out;
}
