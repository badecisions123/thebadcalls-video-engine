import type { Emphasis, Word } from "../types";

/**
 * Words that signal bad news. Matched against the lowercased word with
 * punctuation stripped, by prefix, so "bankrupt" also covers "bankruptcy".
 */
const ALERT_PREFIXES = [
  "bankrupt", "broke", "collaps", "crash", "disaster", "fail", "fired", "fraud", "lawsuit",
  "sued", "scam", "lost", "losing", "loss", "debt", "dead", "death", "died", "destroy",
  "ruin", "worst", "mistake", "shut", "layoff", "laid", "plummet", "tank", "sank", "sink",
  "scandal", "arrest", "prison", "jail", "illegal", "regret", "catastroph", "doom", "betray",
  "panic", "rejected",
];
/** Words that start like an alert word but aren't one. */
const NOT_ALERT = /^(deadline|deadlock|broker|tanker|sinker|shutter)/;

/** Words that are always fine to capitalize mid-sentence and aren't names. */
const NOT_NAMES = new Set(["i", "i'm", "i've", "i'll", "i'd", "ok", "okay", "tv", "ceo", "ai"]);

const MONEY_WORDS = /^(million|millions|billion|billions|trillion|trillions|thousand|thousands|percent|dollars?|bucks|k)$/;
const SENTENCE_END = /[.!?…:]["')\]]*$/;

const bare = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/^[^\p{L}\p{N}$€£]+|[^\p{L}\p{N}%]+$/gu, "");

/** Picks the emphasis tone for a word based on what it says (ignoring position). */
export function toneOf(text: string): Emphasis | undefined {
  const w = bare(text);
  if (!w) return undefined;
  if (/^(1[89]|20)\d\d$/.test(w)) return "key"; // a year, not an amount
  if (/[$€£%]/.test(w) || /\d/.test(w) || MONEY_WORDS.test(w)) return "money";
  if (ALERT_PREFIXES.some((p) => w.startsWith(p)) && !NOT_ALERT.test(w)) return "alert";
  return undefined;
}

/**
 * Strips `*emphasis*` markers from a script. Returns the plain text to send to
 * the voice, plus which whitespace-separated words were marked. Markers can
 * wrap several words: `*Toys R Us*`.
 */
export function parseScript(script: string): { text: string; marked: boolean[] } {
  let text = "";
  let inside = false;
  const marked: boolean[] = [];
  let wordMarked = false;
  let inWord = false;

  for (const ch of script) {
    if (ch === "*") {
      inside = !inside;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) marked.push(wordMarked);
      inWord = false;
      wordMarked = false;
    } else {
      inWord = true;
      wordMarked ||= inside;
    }
    text += ch;
  }
  if (inWord) marked.push(wordMarked);
  return { text, marked };
}

export type EmphasisOptions = {
  /** Detect bad-news words, numbers/money and names automatically. */
  auto: boolean;
  /** Per-word flags from parseScript(), in the same order as `words`. */
  marked?: boolean[];
};

/** Returns a copy of `words` with `emphasis` set on the words worth calling out. */
export function applyEmphasis(words: Word[], { auto, marked }: EmphasisOptions): Word[] {
  if (marked && marked.length !== words.length) {
    console.warn(`  ! Script has ${marked.length} words but the voice returned ${words.length}; ignoring *markers*`);
    marked = undefined;
  }

  // Repeating a name's callout every time dulls it, so auto-detected names get the first mention only.
  const seenNames = new Set<string>();
  return words.map((word, i) => {
    const tone = toneOf(word.text);
    if (marked?.[i]) return { ...word, emphasis: tone ?? "key" };
    if (!auto) return word;
    if (tone) return { ...word, emphasis: tone };

    // A capitalized word mid-sentence is probably a name (company, person, place).
    const prev = words[i - 1];
    const letters = word.text.replace(/^[^\p{L}]+/u, "");
    const midSentence = prev && !SENTENCE_END.test(prev.text);
    const name = bare(word.text);
    if (midSentence && /^\p{Lu}/u.test(letters) && !NOT_NAMES.has(name) && !seenNames.has(name)) {
      seenNames.add(name);
      return { ...word, emphasis: "key" };
    }
    return word;
  });
}
