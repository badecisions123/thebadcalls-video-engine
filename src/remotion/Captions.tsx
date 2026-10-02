import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { type CaptionPage, type CaptionStyle, type Emphasis, VIDEO_WIDTH, type Word } from "../types";
import { CAPTION_FONT } from "./fonts";

const toneColor = (style: CaptionStyle, emphasis: Emphasis) =>
  emphasis === "alert" ? style.alertColor : emphasis === "money" ? style.moneyColor : style.keyColor;

/** One word: pops in when it's spoken, then settles. Emphasized words hit harder. */
const AnimatedWord: React.FC<{ word: Word; pageStart: number; style: CaptionStyle }> = ({
  word,
  pageStart,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Frames since this word started (frame is relative to the page's Sequence).
  const sinceStart = frame - Math.round((word.start - pageStart) * fps);
  const now = pageStart + frame / fps;
  const speaking = now >= word.start && now < word.end;
  const emphasis = word.emphasis;

  const enter = spring({
    frame: sinceStart,
    fps,
    config: emphasis ? { damping: 11, stiffness: 260, mass: 0.6 } : { damping: 14, stiffness: 300 },
    durationInFrames: emphasis ? 12 : 7,
  });

  // Not-yet-spoken words keep their space so the line doesn't reflow.
  const opacity = sinceStart < 0 ? 0 : interpolate(sinceStart, [0, 2], [0, 1], { extrapolateRight: "clamp" });
  let scale = emphasis ? interpolate(enter, [0, 1], [1.8, 1]) : interpolate(enter, [0, 1], [0.6, 1]);
  const lift = emphasis ? 0 : interpolate(enter, [0, 1], [24, 0]);
  if (speaking && !emphasis) scale *= 1.06;

  // Alert words shake for a moment when they land.
  const shake =
    emphasis === "alert" && sinceStart >= 0 && sinceStart < 10
      ? Math.sin(sinceStart * 2.6) * interpolate(sinceStart, [0, 10], [10, 0])
      : 0;
  const tilt = emphasis ? interpolate(enter, [0, 1], [-8, -2]) : 0;

  // Emphasized words are drawn bigger, but shrink to fit the caption width
  // (heavy uppercase glyphs are roughly 0.8em wide; the block is 86% of the frame width).
  const fitEm = (0.86 * VIDEO_WIDTH) / (Math.max(1, word.text.length) * 0.8 * style.fontSize);
  const emphasisEm = Math.min(1.35, fitEm);

  const color = emphasis ? toneColor(style, emphasis) : speaking ? style.highlightColor : style.color;
  const glow = emphasis ? `, 0 0 28px ${toneColor(style, emphasis)}AA` : "";

  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        color,
        fontSize: emphasis ? `${emphasisEm}em` : "1em",
        margin: emphasis ? "0.04em 0.2em" : "0 0.18em",
        transform: `translate(${shake}px, ${lift}px) scale(${scale}) rotate(${tilt}deg)`,
        textShadow: `0 6px 18px rgba(0,0,0,0.6)${glow}`,
      }}
    >
      {word.text}
    </span>
  );
};

/** "pop" style: words appear as they're spoken; emphasized words get their own bouncing line. */
const PopPage: React.FC<{ page: CaptionPage; style: CaptionStyle }> = ({ page, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 240 }, durationInFrames: 8 });
  const totalFrames = Math.round((page.end - page.start) * fps);
  // Quick fade/drop on the way out so pages don't just blink off.
  const exit = interpolate(frame, [totalFrames - 3, totalFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });

  // Emphasized words get their own line so they read as the punchline.
  const lines: Word[][] = [];
  for (const w of page.words) {
    const last = lines[lines.length - 1];
    if (w.emphasis || !last || last[last.length - 1].emphasis) lines.push([w]);
    else last.push(w);
  }

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: `${style.position * 100}%`,
          left: "7%",
          width: "86%",
          transform: `translateY(-50%) translateY(${(1 - enter) * 40}px) scale(${0.9 + 0.1 * enter})`,
          opacity: exit,
          textAlign: "center",
          fontFamily: `'${CAPTION_FONT}', 'Arial Black', sans-serif`,
          fontWeight: 900,
          fontSize: style.fontSize,
          lineHeight: 1.15,
          letterSpacing: -1,
          textTransform: style.uppercase ? "uppercase" : "none",
          WebkitTextStroke: `${Math.round(style.fontSize / 7)}px ${style.strokeColor}`,
          paintOrder: "stroke fill",
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>
            {line.map((w, j) => (
              <AnimatedWord key={j} word={w} pageStart={page.start} style={style} />
            ))}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/**
 * "whip" style, replicating a CapCut caption: the whole caption on one line,
 * keywords colored. It snaps in from a wide horizontal stretch with heavy
 * sideways motion blur and leaves the same way in reverse. Values were
 * measured frame by frame from the reference clip (30 fps).
 */
const WHIP_FRAMES = 5;
// Per frame of the transition, from "fully in motion" (index 0) to "at rest".
const WHIP_SCALE = [1.4, 1.25, 1.12, 1.05, 1.02, 1];
const WHIP_BLUR = [26, 16, 9, 4, 1.5, 0];
const WHIP_OPACITY = [0.92, 1, 1, 1, 1, 1];

const WhipPage: React.FC<{ page: CaptionPage; style: CaptionStyle; id: string }> = ({ page, style, id }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.max(1, Math.round((page.end - page.start) * fps));

  // Short captions get a shorter transition so they still settle for a moment.
  const n = Math.max(2, Math.min(WHIP_FRAMES, Math.floor(total / 3)));
  const steps = WHIP_SCALE.map((_, i) => (i * n) / WHIP_FRAMES);
  // Distance (in frames) from the nearest edge of the caption's time on screen.
  const t = Math.min(frame, total - 1 - frame);
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const scaleX = interpolate(t, steps, WHIP_SCALE, clamp);
  const blur = interpolate(t, steps, WHIP_BLUR, clamp);
  const opacity = interpolate(t, steps, WHIP_OPACITY, clamp);

  // Keep it on one line: shrink long captions to fit (Montserrat Black caps average ~0.68em wide).
  const chars = page.words.reduce((n, w) => n + w.text.length + 1, -1);
  const fontSize = Math.min(style.fontSize, (0.9 * VIDEO_WIDTH) / (Math.max(1, chars) * 0.68));

  const text = (shadow: boolean) =>
    page.words.map((w, i) => (
      <span key={i} style={{ color: shadow ? style.strokeColor : w.emphasis ? toneColor(style, w.emphasis) : style.color }}>
        {w.text}
        {i < page.words.length - 1 ? " " : ""}
      </span>
    ));

  const layer: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    textAlign: "center",
    whiteSpace: "nowrap",
  };

  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={`${blur} ${blur * 0.08}`} />
        </filter>
      </svg>
      <div
        style={{
          position: "absolute",
          top: `${style.position * 100}%`,
          left: 0,
          right: 0,
          height: fontSize,
          marginTop: -fontSize / 2,
          transform: `scaleX(${scaleX})`,
          filter: blur > 0.3 ? `url(#${id})` : undefined,
          opacity,
          fontFamily: `'${CAPTION_FONT}', 'Arial Black', sans-serif`,
          fontWeight: 900,
          fontSize,
          lineHeight: 1,
          textTransform: style.uppercase ? "uppercase" : "none",
        }}
      >
        {/*
          CapCut-style shadow: a thickened, blurred black copy of the text sitting
          slightly low. Measured on the reference: ~9px of blur, ~3px down, and
          60-80% darkening right at the letter edges, with no hard outline.
        */}
        <div
          style={{
            ...layer,
            transform: `translateY(${fontSize * 0.04}px)`,
            WebkitTextStroke: `${fontSize * 0.14}px ${style.strokeColor}`,
            filter: `blur(${fontSize * 0.12}px)`,
            opacity: 1,
          }}
        >
          {text(true)}
        </div>
        <div style={layer}>{text(false)}</div>
      </div>
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{ pages: CaptionPage[]; style: CaptionStyle }> = ({ pages, style }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {pages.map((page, i) => {
        const from = Math.round(page.start * fps);
        const duration = Math.max(1, Math.round(page.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            {style.animation === "whip" ? (
              <WhipPage page={page} style={style} id={`whip-blur-${i}`} />
            ) : (
              <PopPage page={page} style={style} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
