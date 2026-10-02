// Shared types between the Node pipeline and the Remotion composition.
// Keep this file free of Node-only imports: it is bundled into the browser.

/**
 * How a word is called out on screen:
 * - alert: bad news (bankrupt, fired, lawsuit...) in red
 * - money: numbers, money and percentages in green
 * - key:   names and anything marked *like this* in the script
 */
export type Emphasis = "alert" | "money" | "key";

/** A single spoken word with its timing in seconds. */
export type Word = {
  text: string;
  start: number;
  end: number;
  emphasis?: Emphasis;
};

/** A group of words shown on screen together. */
export type CaptionPage = {
  text: string;
  start: number;
  end: number;
  words: Word[];
};

/** One B-roll shot placed on the timeline (all values in frames). */
export type Shot = {
  /** Path relative to the Remotion public dir, resolved with staticFile(). */
  src: string;
  /** Timeline frame the shot starts at. */
  from: number;
  /** Number of timeline frames the shot is on screen. */
  durationInFrames: number;
  /** Frame inside the source clip to start playing from. */
  trimBefore: number;
};

export type CaptionStyle = {
  /**
   * - whip: whole caption at once, one line, keywords colored; enters and exits
   *   with a horizontal stretch and motion blur
   * - pop:  words pop in as spoken; keywords get their own bigger, bouncing line
   */
  animation: "whip" | "pop";
  /** Vertical position of the caption block's center, 0 (top) .. 1 (bottom). */
  position: number;
  fontSize: number;
  color: string;
  highlightColor: string;
  strokeColor: string;
  alertColor: string;
  moneyColor: string;
  keyColor: string;
  uppercase: boolean;
};

export type Effects = {
  /** Slow zoom drift on every B-roll shot, plus a quick zoom-in on each cut. */
  kenBurns: boolean;
  /** Footage punches in (and shakes, for alert words) when an emphasized word is spoken. */
  punchIn: boolean;
  /** Thin progress bar along the top edge. */
  progressBar: boolean;
};

export type VideoProps = {
  fps: number;
  durationInFrames: number;
  audioSrc: string | null;
  shots: Shot[];
  captions: CaptionPage[];
  captionStyle: CaptionStyle;
  effects: Effects;
};

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const COMPOSITION_ID = "VerticalVideo";

export const CAPTION_PRESETS = {
  whip: {
    animation: "whip",
    position: 0.778,
    fontSize: 72,
    color: "#FFFFFF",
    highlightColor: "#07F807",
    strokeColor: "#000000",
    alertColor: "#F7090A",
    moneyColor: "#07F807",
    keyColor: "#11F8F9",
    uppercase: true,
  },
  pop: {
    animation: "pop",
    position: 0.68,
    fontSize: 92,
    color: "#FFFFFF",
    highlightColor: "#FFD400",
    strokeColor: "#000000",
    alertColor: "#FF3B30",
    moneyColor: "#2EE86B",
    keyColor: "#4FD8FF",
    uppercase: true,
  },
} satisfies Record<CaptionStyle["animation"], CaptionStyle>;

export const DEFAULT_CAPTION_STYLE: CaptionStyle = CAPTION_PRESETS.whip;

export const DEFAULT_EFFECTS: Effects = {
  kenBurns: true,
  punchIn: true,
  progressBar: true,
};
