import assert from "node:assert/strict";
import { test } from "node:test";
import { alignmentToWords, buildCaptionPages, sentenceBoundaries, toSrt } from "./captions";

const align = (text: string, step = 0.1) => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * step),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * step),
  };
};

test("alignmentToWords groups characters into timed words", () => {
  const words = alignmentToWords(align("Hi  there."));
  assert.deepEqual(words.map((w) => w.text), ["Hi", "there."]);
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 0.2) < 1e-9);
  assert.ok(Math.abs(words[1].start - 0.4) < 1e-9);
});

test("buildCaptionPages respects max words and sentence ends", () => {
  const words = alignmentToWords(align("One two three four. Five six"));
  const pages = buildCaptionPages(words, { maxWords: 3 });
  assert.deepEqual(pages.map((p) => p.text), ["One two three", "four.", "Five six"]);
  // Short gaps are held so captions don't flicker.
  assert.equal(pages[0].end, pages[1].start);
  assert.deepEqual(sentenceBoundaries(pages), [pages[2].start]);
});

test("toSrt formats timestamps", () => {
  const srt = toSrt([{ text: "Hello", start: 1.5, end: 62.25, words: [] }]);
  assert.equal(srt, "1\n00:00:01,500 --> 00:01:02,250\nHello\n");
});
