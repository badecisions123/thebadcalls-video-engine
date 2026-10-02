import assert from "node:assert/strict";
import { test } from "node:test";
import type { Word } from "../types";
import { applyEmphasis, parseScript, toneOf } from "./emphasis";

const words = (text: string): Word[] =>
  text.split(" ").map((t, i) => ({ text: t, start: i, end: i + 1 }));

test("parseScript strips markers and records marked words", () => {
  const { text, marked } = parseScript("They sold *Toys R Us* for *$6.6 billion*.");
  assert.equal(text, "They sold Toys R Us for $6.6 billion.");
  assert.deepEqual(marked, [false, false, true, true, true, false, true, true]);
});

test("toneOf classifies bad news and money", () => {
  assert.equal(toneOf("bankrupt."), "alert");
  assert.equal(toneOf("Bankruptcy"), "alert");
  assert.equal(toneOf("deadline"), undefined);
  assert.equal(toneOf("$50"), "money");
  assert.equal(toneOf("40%"), "money");
  assert.equal(toneOf("billion,"), "money");
  assert.equal(toneOf("company"), undefined);
  assert.equal(toneOf("2000,"), "key");
});

test("auto emphasis catches names mid-sentence but not sentence starts or 'I'", () => {
  const out = applyEmphasis(words("Then I told Blockbuster no. Netflix went bankrupt?"), { auto: true });
  const tagged = out.filter((w) => w.emphasis).map((w) => `${w.text}:${w.emphasis}`);
  assert.deepEqual(tagged, ["Blockbuster:key", "bankrupt?:alert"]);
});

test("marked words are emphasized even with auto off, keeping their tone", () => {
  const { marked } = parseScript("*Netflix* was *bankrupt* soon");
  const out = applyEmphasis(words("Netflix was bankrupt soon"), { auto: false, marked });
  assert.deepEqual(out.map((w) => w.emphasis), ["key", undefined, "alert", undefined]);
});

test("mismatched marker counts are ignored instead of misaligning", () => {
  const out = applyEmphasis(words("one two"), { auto: false, marked: [true] });
  assert.deepEqual(out.map((w) => w.emphasis), [undefined, undefined]);
});

test("auto-detected names are only called out on first mention", () => {
  const out = applyEmphasis(words("They met Blockbuster. Then Blockbuster said no to Blockbuster"), { auto: true });
  assert.equal(out.filter((w) => w.emphasis === "key").length, 1);
});
