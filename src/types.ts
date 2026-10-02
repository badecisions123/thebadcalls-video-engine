// Shared types between the Node pipeline and the Remotion composition.
// Keep this file free of Node-only imports: it is bundled into the browser.

/** A single spoken word with its timing in seconds. */
export type Word = {
  text: string;
  start: number;
  end: number;
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
  /** Vertical position of the caption block's center, 0 (top) .. 1 (bottom). */
  position: number;
  fontSize: number;
  color: string;
  highlightColor: string;
  strokeColor: string;
  uppercase: boolean;
};

export type VideoProps = {
  fps: number;
  durationInFrames: number;
  audioSrc: string | null;
  shots: Shot[];
  captions: CaptionPage[];
  captionStyle: CaptionStyle;
};

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const COMPOSITION_ID = "VerticalVideo";

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  position: 0.68,
  fontSize: 92,
  color: "#FFFFFF",
  highlightColor: "#FFD400",
  strokeColor: "#000000",
  uppercase: true,
};
