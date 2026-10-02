import type { CaptionPage, Word } from "../types";
import type { Alignment } from "./voiceover";

/** Collapses ElevenLabs character timings into word timings. */
export function alignmentToWords(alignment: Alignment): Word[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words: Word[] = [];
  let text = "";
  let start = 0;
  let end = 0;

  const flush = () => {
    if (text) words.push({ text, start, end });
    text = "";
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!text) start = starts[i];
    text += ch;
    end = ends[i];
  }
  flush();
  return words;
}

export type CaptionOptions = {
  /** Max words per on-screen caption. */
  maxWords: number;
  /** Max characters per on-screen caption (excluding spaces between words). */
  maxChars: number;
  /** A pause longer than this (seconds) always starts a new caption. */
  maxGap: number;
  /** Hold a caption on screen until the next one if the gap is shorter than this (seconds). */
  holdGap: number;
};

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = {
  maxWords: 3,
  maxChars: 18,
  maxGap: 0.4,
  holdGap: 0.6,
};

const SENTENCE_END = /[.!?…]["')\]]*$/;
const CLAUSE_END = /[,;:—–-]["')\]]*$/;

/** Groups words into short, punchy caption pages. */
export function buildCaptionPages(words: Word[], options: Partial<CaptionOptions> = {}): CaptionPage[] {
  const opts = { ...DEFAULT_CAPTION_OPTIONS, ...options };
  const pages: CaptionPage[] = [];
  let current: Word[] = [];

  const flush = () => {
    if (!current.length) return;
    pages.push({
      text: current.map((w) => w.text).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prev = current[current.length - 1];
    const chars = current.reduce((n, w) => n + w.text.length, 0) + word.text.length;

    if (
      prev &&
      (current.length >= opts.maxWords || chars > opts.maxChars || word.start - prev.end > opts.maxGap)
    ) {
      flush();
    }
    current.push(word);
    if (SENTENCE_END.test(word.text) || CLAUSE_END.test(word.text)) flush();
  }
  flush();

  // Avoid flicker: keep each caption up until the next one starts when the gap is short.
  for (let i = 0; i < pages.length - 1; i++) {
    const gap = pages[i + 1].start - pages[i].end;
    if (gap > 0 && gap < opts.holdGap) pages[i].end = pages[i + 1].start;
  }
  return pages;
}

/** Times (seconds) where a sentence ends — natural places to cut B-roll. */
export function sentenceBoundaries(pages: CaptionPage[]): number[] {
  const cuts: number[] = [];
  for (let i = 0; i < pages.length - 1; i++) {
    const last = pages[i].words[pages[i].words.length - 1];
    if (SENTENCE_END.test(last.text) || CLAUSE_END.test(last.text)) cuts.push(pages[i + 1].start);
  }
  return cuts;
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** Serializes caption pages as SubRip (.srt), handy for uploading to platforms. */
export function toSrt(pages: CaptionPage[]): string {
  return pages
    .map((p, i) => `${i + 1}\n${srtTime(p.start)} --> ${srtTime(p.end)}\n${p.text}\n`)
    .join("\n");
}
