import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaptionPage, Word } from "../types";

// ---------------------------------------------------------------------------
// Script -> segments -> search terms
// ---------------------------------------------------------------------------

/** A stretch of the voiceover (one sentence, or a few short ones) that gets its own B-roll. */
export type Segment = {
  text: string;
  /** Seconds. The first segment starts at 0 and each ends where the next begins. */
  start: number;
  end: number;
  words: Word[];
  /** Searches written in the script as `[video rental store]`, tried before anything else. */
  queries?: string[];
};

const SENTENCE_END = /[.!?…]["')\]]*$/;

/**
 * Splits the captions into sentence-sized segments covering 0..totalSeconds.
 * Sentences shorter than `minSeconds` are merged into the next one so we don't
 * fetch a clip for "The lesson?".
 */
export function scriptSegments(pages: CaptionPage[], totalSeconds: number, minSeconds = 2): Segment[] {
  const sentences: Word[][] = [];
  let current: Word[] = [];
  for (const page of pages) {
    current.push(...page.words);
    const last = page.words[page.words.length - 1];
    if (last && SENTENCE_END.test(last.text)) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length) sentences.push(current);

  const merged: Word[][] = [];
  for (const s of sentences) {
    const prev = merged[merged.length - 1];
    if (prev && prev[prev.length - 1].end - prev[0].start < minSeconds) prev.push(...s);
    else merged.push([...s]);
  }
  // A short final sentence joins the one before it instead.
  if (merged.length > 1) {
    const last = merged[merged.length - 1];
    if (last[last.length - 1].end - last[0].start < minSeconds) merged[merged.length - 2].push(...merged.pop()!);
  }

  return merged.map((words, i) => ({
    text: words.map((w) => w.text).join(" "),
    start: i === 0 ? 0 : words[0].start,
    end: i === merged.length - 1 ? totalSeconds : merged[i + 1][0].start,
    words,
  }));
}

// Words that never make a useful stock-footage search on their own.
const STOPWORDS = new Set(
  `a about above after again against all almost also although always am among an and another any anyone
  anything are around as at away back be became because become been before being below between both but by
  can cannot could did do does doing done down during each either else enough even ever every everyone
  everything few for from further get gets getting give given go goes going gone got had has have having he
  her here hers herself him himself his how however i if in into is it its itself just keep kept know known
  last later least less let like made make makes making many may me might more most much must my myself
  never new next no nobody none nor not nothing now of off often on once one only or other others our ours
  ourselves out over own per perhaps put quite rather really said same say says see seem seemed several she
  should since so some someone something sometimes still such take taken than that the their theirs them
  themselves then there these they thing things think this those though through thus to together too took
  toward under until up upon us use used very was way we well went were what whatever when where whether
  which while who whom whose why will with within without would yet you your yours yourself yourselves
  here's that's it's there's what's who's don't doesn't didn't isn't wasn't aren't weren't won't can't
  couldn't shouldn't wouldn't i'm i've i'll i'd you're you've they're they've we're we've let's
  just only even still already really actually basically literally simply
  ago year years month months day days time times today tomorrow yesterday week weeks
  first second third half lot lots kind sort part
  offered offer offers called call calls told tell tells asked ask asks turned turn turns came come comes
  started start starts tried try tries wanted want wants needed need needs looked look looks seemed
  laughed decided decide happened happen happens became becoming worth now biggest big bigger small
  lesson trick thing point reason fact idea
  two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred hundreds
  thousand thousands million millions billion billions trillion dozen dozens`.split(/\s+/),
);

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/**
 * Ranks the words of a segment as stock-footage search terms: names and
 * marked words first (they're what the sentence is about), then other
 * content words, longer (more specific) first. Numbers and money are skipped:
 * "$50 million" doesn't search well.
 */
export function searchTerms(words: Word[], max = 4): string[] {
  const scored = new Map<string, number>();
  words.forEach((w, i) => {
    const term = normalize(w.text).replace(/'s$/, "");
    if (term.length < 3 || STOPWORDS.has(term) || /\d/.test(term) || w.emphasis === "money") return;
    const score = (w.emphasis === "key" ? 100 : w.emphasis === "alert" ? 50 : 0) + term.length - i * 0.01;
    scored.set(term, Math.max(scored.get(term) ?? -Infinity, score));
  });
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

// ---------------------------------------------------------------------------
// Pixabay API
// ---------------------------------------------------------------------------

const PIXABAY_VIDEOS_URL = "https://pixabay.com/api/videos/";

type Rendition = { url: string; width: number; height: number; size: number };

export type PixabayHit = {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  videos: Partial<Record<"large" | "medium" | "small" | "tiny", Rendition>>;
};

type PixabayResponse = { total: number; totalHits: number; hits: PixabayHit[] };

export type StockOptions = {
  /** Sent as the `key` parameter. Omit when a proxy injects it. */
  apiKey?: string;
  /** Where search results (kept 24h, as Pixabay's terms require) and downloads are cached. */
  cacheDir: string;
  fetchImpl?: typeof fetch;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Searches Pixabay videos, caching each query's results for 24 hours. */
export async function searchPixabay(query: string, opts: StockOptions): Promise<PixabayHit[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    q: query.slice(0, 100),
    video_type: "film",
    safesearch: "true",
    order: "popular",
    per_page: "20",
  });
  const cacheFile = path.join(
    opts.cacheDir,
    `search-${createHash("sha256").update(params.toString()).digest("hex").slice(0, 16)}.json`,
  );
  if (existsSync(cacheFile) && Date.now() - (await stat(cacheFile)).mtimeMs < DAY_MS) {
    return (JSON.parse(await readFile(cacheFile, "utf8")) as PixabayResponse).hits;
  }

  if (opts.apiKey) params.set("key", opts.apiKey);
  const res = await doFetch(`${PIXABAY_VIDEOS_URL}?${params}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Pixabay search for "${query}" failed (${res.status} ${res.statusText}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as PixabayResponse;
  await mkdir(opts.cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(data));
  return data.hits ?? [];
}

/**
 * Picks the file to download: the smallest rendition that is at least 1080px
 * tall (it gets cover-cropped to 1080x1920, so more is wasted bandwidth),
 * else the tallest available.
 */
export function pickRendition(hit: PixabayHit): Rendition | undefined {
  const all = Object.values(hit.videos).filter((r): r is Rendition => !!r?.url && r.width > 0);
  const bigEnough = all.filter((r) => r.height >= 1080).sort((a, b) => a.height - b.height);
  return bigEnough[0] ?? all.sort((a, b) => b.height - a.height)[0];
}

// Footage that never works as B-roll under captions.
const JUNK_TAGS = /green ?screen|chroma|alpha channel|transparent|ai generated|anime|cartoon|animation|animated|intro|countdown|3d render/i;
// Pixabay matches any tag, and uploaders often stuff dozens of loosely related tags,
// so a query word only counts if it's among a clip's first few tags.
const RELEVANT_TAG_POSITIONS = 8;

/**
 * How well a hit's tags match the query: [matched words, sum of their tag positions],
 * or [0, 0] when it doesn't match well enough. Every word of a one- or two-word
 * query must match (so "watching tv" doesn't take a "bird watching" clip);
 * longer queries may miss one word. A tag containing the whole phrase counts as all words.
 */
function tagMatch(hit: PixabayHit, query: string): [number, number] {
  const tags = hit.tags.toLowerCase().split(/\s*,\s*/).slice(0, RELEVANT_TAG_POSITIONS);
  const phrase = query.toLowerCase().trim();
  const terms = phrase.split(/\s+/).filter((t) => t.length > 1);
  const phraseAt = tags.findIndex((tag) => tag.includes(phrase));
  if (phraseAt >= 0) return [terms.length, phraseAt];

  let matched = 0;
  let positions = 0;
  for (const term of terms) {
    const at = tags.findIndex((tag) => tag.split(/\s+/).some((word) => word === term || word.startsWith(term)));
    if (at >= 0) {
      matched++;
      positions += at;
    }
  }
  const needed = terms.length <= 2 ? terms.length : terms.length - 1;
  return matched >= needed ? [matched, positions] : [0, 0];
}

/**
 * Keeps hits that are long enough, unused, not junk (green screen, AI, cartoons...)
 * and actually about the query (a query word among their first tags). Ranks by
 * how many query words match, then portrait first (no crop), then Pixabay's order.
 */
export function rankHits(hits: PixabayHit[], minSeconds: number, exclude: Set<number>, query = ""): PixabayHit[] {
  return hits
    .map((hit, i) => ({ hit, i, r: pickRendition(hit), m: query ? tagMatch(hit, query) : ([1, 0] as [number, number]) }))
    .filter(({ hit, r, m }) => r && hit.duration >= minSeconds && !exclude.has(hit.id) && !JUNK_TAGS.test(hit.tags) && m[0] > 0)
    .sort(
      (a, b) =>
        b.m[0] - a.m[0] ||
        Number(b.r!.height > b.r!.width) - Number(a.r!.height > a.r!.width) ||
        a.m[1] - b.m[1] ||
        a.i - b.i,
    )
    .map(({ hit }) => hit);
}

async function download(url: string, dest: string, doFetch: typeof fetch) {
  if (existsSync(dest)) return;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = `${dest}.part`;
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await rename(tmp, dest);
}

export type StockClip = {
  /** Index of the segment this clip belongs to. */
  segment: number;
  file: string;
  query: string;
  pixabayId: number;
  pageURL: string;
};

export type FetchBrollOptions = StockOptions & {
  /** Clips per segment: roughly one per `targetShot` seconds, between 1 and `maxPerSegment`. */
  targetShot: number;
  maxPerSegment: number;
  /** Shortest clip worth downloading (seconds). */
  minClipSeconds: number;
  /** Searched when none of a segment's own terms return anything. */
  fallbackTerms: string[];
  log?: (line: string) => void;
};

/**
 * For each segment, searches Pixabay with that segment's keywords (best first,
 * falling back to broader terms) and downloads enough distinct clips to cover it.
 */
export async function fetchStockBroll(segments: Segment[], opts: FetchBrollOptions): Promise<StockClip[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const videosDir = path.join(opts.cacheDir, "videos");
  await mkdir(videosDir, { recursive: true });
  const used = new Set<number>();
  const clips: StockClip[] = [];
  const scriptTerms = searchTerms(segments.flatMap((s) => s.words), 6);

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const want = Math.max(1, Math.min(opts.maxPerSegment, Math.round((seg.end - seg.start) / opts.targetShot)));
    const own = searchTerms(seg.words);
    // Two-word query first (more specific), then each term alone, then script-wide terms, then the fallbacks.
    const queries = [
      ...(seg.queries ?? []),
      ...(own.length >= 2 ? [`${own[0]} ${own[1]}`] : []),
      ...own,
      ...scriptTerms.filter((t) => !own.includes(t)),
      ...opts.fallbackTerms,
    ];

    const picked: StockClip[] = [];
    for (const query of queries) {
      if (picked.length >= want) break;
      const hits = rankHits(await searchPixabay(query, opts), opts.minClipSeconds, used, query);
      for (const hit of hits) {
        if (picked.length >= want) break;
        const r = pickRendition(hit)!;
        const file = path.join(videosDir, `${hit.id}-${r.width}x${r.height}.mp4`);
        await download(r.url, file, doFetch);
        used.add(hit.id);
        picked.push({ segment: si, file, query, pixabayId: hit.id, pageURL: hit.pageURL });
      }
    }
    if (!picked.length) throw new Error(`No Pixabay clips found for "${seg.text}" (tried: ${queries.join(", ")})`);
    opts.log?.(`    "${seg.text.slice(0, 48)}${seg.text.length > 48 ? "..." : ""}" -> ${[...new Set(picked.map((p) => p.query))].join(", ")} (${picked.length})`);
    clips.push(...picked);
  }
  return clips;
}
