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
 * "whip" style: the whole caption on one line, keywords colored. It snaps in
 * with a horizontal stretch and motion blur, then squashes out the same way.
 * Timings were measured frame by frame from the reference clip (30 fps).
 */
const WhipPage: React.FC<{ page: CaptionPage; style: CaptionStyle; id: string }> = ({ page, style, id }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.round((page.end - page.start) * fps);
  const left = total - frame; // frames until this caption is gone

  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  let scaleX = interpolate(frame, [0, 1, 2, 4], [0.7, 1.12, 1.05, 1], clamp);
  let blur = interpolate(frame, [0, 1, 2, 4], [30, 18, 8, 0], clamp);
  let opacity = interpolate(frame, [0, 1], [0.45, 1], clamp);
  if (left <= 4) {
    scaleX = interpolate(left, [0, 1, 2, 4], [0.45, 0.75, 0.9, 1], clamp);
    blur = interpolate(left, [0, 1, 2, 4], [30, 20, 10, 0], clamp);
    opacity = interpolate(left, [0, 2, 4], [0.3, 0.8, 1], clamp);
  }

  // Keep it on one line: shrink long captions to fit (Montserrat Black caps average ~0.68em wide).
  const chars = page.words.reduce((n, w) => n + w.text.length + 1, -1);
  const fontSize = Math.min(style.fontSize, (0.9 * VIDEO_WIDTH) / (Math.max(1, chars) * 0.68));
  // A soft dark halo rather than a hard outline, as in the reference.
  const shadow = "0 0 6px rgba(0,0,0,0.95), 0 0 14px rgba(0,0,0,0.75), 0 4px 18px rgba(0,0,0,0.6)";

  return (
    <AbsoluteFill>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id} x="-50%" y="-20%" width="200%" height="140%">
          <feGaussianBlur stdDeviation={`${blur} 0`} />
        </filter>
      </svg>
      <div
        style={{
          position: "absolute",
          top: `${style.position * 100}%`,
          left: 0,
          right: 0,
          transform: `translateY(-50%) scaleX(${scaleX})`,
          filter: blur > 0.5 ? `url(#${id})` : undefined,
          opacity,
          textAlign: "center",
          whiteSpace: "nowrap",
          fontFamily: `'${CAPTION_FONT}', 'Arial Black', sans-serif`,
          fontWeight: 900,
          fontSize,
          lineHeight: 1,
          textTransform: style.uppercase ? "uppercase" : "none",
          WebkitTextStroke: `${Math.max(1, Math.round(fontSize / 24))}px ${style.strokeColor}`,
          paintOrder: "stroke fill",
        }}
      >
        {page.words.map((w, i) => {
          const color = w.emphasis ? toneColor(style, w.emphasis) : style.color;
          return (
            <span
              key={i}
              style={{
                color,
                textShadow: w.emphasis ? `${shadow}, 0 0 12px ${color}55` : shadow,
              }}
            >
              {w.text}
              {i < page.words.length - 1 ? " " : ""}
            </span>
          );
        })}
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
