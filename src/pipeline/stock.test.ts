import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CaptionPage, Word } from "../types";
import { fetchStockBroll, type PixabayHit, pickRendition, rankHits, scriptSegments, searchTerms } from "./stock";

const w = (text: string, start: number, end: number, emphasis?: Word["emphasis"]): Word => ({ text, start, end, emphasis });
const page = (...words: Word[]): CaptionPage => ({
  text: words.map((x) => x.text).join(" "),
  start: words[0].start,
  end: words[words.length - 1].end,
  words,
});

const hit = (id: number, width: number, height: number, duration = 10, tags = "test"): PixabayHit => ({
  id,
  pageURL: `https://pixabay.com/videos/${id}/`,
  tags,
  duration,
  videos: {
    large: { url: "", width: 0, height: 0, size: 0 },
    medium: { url: `https://cdn.pixabay.com/${id}/medium.mp4`, width, height, size: 1 },
    small: { url: `https://cdn.pixabay.com/${id}/small.mp4`, width: width / 2, height: height / 2, size: 1 },
  },
});

test("searchTerms puts names first and skips filler, numbers and money", () => {
  const words = [
    w("In", 0, 1),
    w("2000,", 1, 2, "key"),
    w("Netflix", 2, 3, "key"),
    w("offered", 3, 4),
    w("to", 4, 5),
    w("sell", 5, 6),
    w("itself", 6, 7),
    w("to", 7, 8),
    w("Blockbuster", 8, 9, "key"),
    w("for", 9, 10),
    w("$50", 10, 11, "money"),
    w("million.", 11, 12, "money"),
  ];
  assert.deepEqual(searchTerms(words), ["blockbuster", "netflix", "sell"]);
  assert.deepEqual(searchTerms([w("Ten", 0, 1), w("years", 1, 2), w("hundreds", 2, 3), w("of", 3, 4), w("stores.", 4, 5)]), ["stores"]);
});

test("scriptSegments splits on sentences, merges short ones, and covers the whole timeline", () => {
  const pages = [
    page(w("Blockbuster", 0.2, 1), w("was", 1, 1.5), w("huge.", 1.5, 3)),
    page(w("Then", 3.2, 3.5), w("Netflix", 3.5, 4), w("arrived.", 4, 6)),
    page(w("Oops.", 6.2, 6.8)), // too short on its own: merged into the sentence before
  ];
  const segs = scriptSegments(pages, 8);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[0].end, 3.2);
  assert.equal(segs[1].start, 3.2);
  assert.equal(segs[1].end, 8);
  assert.equal(segs[1].text, "Then Netflix arrived. Oops.");
});

test("pickRendition prefers the smallest file that is at least 1080px tall", () => {
  assert.equal(pickRendition(hit(1, 1920, 1080))?.width, 1920);
  assert.equal(pickRendition(hit(2, 1280, 720))?.width, 1280); // none tall enough: take the tallest
});

test("rankHits puts portrait clips first and drops short or already-used clips", () => {
  const ranked = rankHits([hit(1, 1920, 1080), hit(2, 1080, 1920), hit(3, 1080, 1920, 1), hit(4, 1920, 1080)], 3, new Set([4]));
  assert.deepEqual(ranked.map((h) => h.id), [2, 1]);
});

test("rankHits drops tag-stuffed matches and junk footage, and prefers better matches", () => {
  const stuffed = "frog, wildlife, film, movie, cinema, popcorn, projector, camera, theatre, netflix";
  const ranked = rankHits(
    [
      hit(1, 1920, 1080, 10, stuffed), // "netflix" is tag #10: not really about Netflix
      hit(2, 1920, 1080, 10, "green, cat, green screen, netflix"), // green screen
      hit(3, 1920, 1080, 10, "tv, netflix, remote"),
      hit(4, 1920, 1080, 10, "netflix, streaming, tv, remote"), // matches both words
    ],
    3,
    new Set(),
    "netflix streaming",
  );
  assert.deepEqual(ranked.map((h) => h.id), [4]); // #3 lacks "streaming"

  // One word of a two-word query isn't enough; the whole phrase in one tag is.
  const tv = rankHits(
    [hit(5, 1920, 1080, 10, "stork, bird, bird watching"), hit(6, 1920, 1080, 10, "living room, watching tv, couch")],
    3,
    new Set(),
    "watching tv",
  );
  assert.deepEqual(tv.map((h) => h.id), [6]);
});

test("fetchStockBroll tries the script's [search terms] first", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stock-"));
  const queries: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname !== "pixabay.com") return new Response("video");
    const q = url.searchParams.get("q")!;
    queries.push(q);
    const hits = q === "video rental store" ? [hit(7, 1920, 1080, 10, "video, store, rental, vhs")] : [];
    return new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }));
  }) as typeof fetch;
  try {
    const clips = await fetchStockBroll(
      [{ text: "Blockbuster was huge.", start: 0, end: 3, words: [w("Blockbuster", 0, 1, "key")], queries: ["video rental store"] }],
      { cacheDir: dir, fetchImpl: fakeFetch, targetShot: 3, maxPerSegment: 1, minClipSeconds: 3, fallbackTerms: [] },
    );
    assert.equal(queries[0], "video rental store");
    assert.deepEqual(clips.map((c) => c.pixabayId), [7]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchStockBroll queries per segment, falls back, dedupes and downloads", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stock-"));
  const queries: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "pixabay.com") {
      const q = url.searchParams.get("q")!;
      queries.push(q);
      assert.equal(url.searchParams.get("key"), "secret");
      const hits =
        q === "popcorn"
          ? [hit(10, 1920, 1080, 10, "popcorn, business")]
          : q === "business"
            ? [hit(10, 1920, 1080, 10, "popcorn, business"), hit(11, 1920, 1080, 10, "business, office")]
            : [];
      return new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }));
    }
    return new Response(`video ${url.pathname}`);
  }) as typeof fetch;

  try {
    const segments = [
      { text: "Popcorn time.", start: 0, end: 3, words: [w("Popcorn", 0.1, 1), w("time.", 1, 2)] },
      { text: "Glorp happened.", start: 3, end: 6, words: [w("Glorp", 3.1, 4), w("happened.", 4, 5)] },
    ];
    const clips = await fetchStockBroll(segments, {
      apiKey: "secret",
      cacheDir: dir,
      fetchImpl: fakeFetch,
      targetShot: 3,
      maxPerSegment: 2,
      minClipSeconds: 3,
      fallbackTerms: ["business"],
    });

    assert.deepEqual(clips.map((c) => [c.segment, c.pixabayId, c.query]), [
      [0, 10, "popcorn"],
      [1, 11, "business"], // 10 was already used by segment 0
    ]);
    assert.ok(existsSync(clips[0].file));
    assert.equal(await readFile(clips[0].file, "utf8"), "video /10/medium.mp4");

    // Search results are cached, so a second run makes no new API calls.
    const before = queries.length;
    await fetchStockBroll(segments, {
      apiKey: "secret",
      cacheDir: dir,
      fetchImpl: fakeFetch,
      targetShot: 3,
      maxPerSegment: 2,
      minClipSeconds: 3,
      fallbackTerms: ["business"],
    });
    assert.equal(queries.length, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with an AI editor: rejected candidates lead to the next searches, and an all-reject falls back", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stock-"));
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname !== "pixabay.com") return new Response("video");
    const q = url.searchParams.get("q")!;
    const ids: Record<string, number[]> = { "rental store": [1, 2, 3], vhs: [4, 5, 6], office: [7] };
    const hits = (ids[q] ?? []).map((id) => hit(id, 1920, 1080, 10, `${q}, thing`));
    return new Response(JSON.stringify({ total: hits.length, totalHits: hits.length, hits }));
  }) as typeof fetch;
  const shown: number[][] = [];
  try {
    const opts = {
      cacheDir: dir,
      fetchImpl: fakeFetch,
      targetShot: 3,
      maxPerSegment: 1,
      minClipSeconds: 3,
      fallbackTerms: [],
    };
    // The AI likes clip 5 only.
    const clips = await fetchStockBroll(
      [{ text: "A shop.", start: 0, end: 3, words: [w("shop.", 0, 1)], aiQueries: ["rental store", "vhs"] }],
      {
        ...opts,
        choose: async (_seg, candidates) => {
          shown.push(candidates.map((c) => c.id));
          return candidates.filter((c) => c.id === 5);
        },
      },
    );
    assert.deepEqual(shown, [[1, 2, 3, 4, 5, 6]]);
    assert.deepEqual(clips.map((c) => [c.pixabayId, c.query]), [[5, "vhs"]]);

    // The AI rejects everything: the best tag match is used rather than leaving the sentence empty.
    const fallback = await fetchStockBroll(
      [{ text: "An office.", start: 0, end: 3, words: [w("office.", 0, 1)], aiQueries: ["office"] }],
      { ...opts, choose: async () => [] },
    );
    assert.deepEqual(fallback.map((c) => c.pixabayId), [7]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
