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

const Page: React.FC<{ page: CaptionPage; style: CaptionStyle }> = ({ page, style }) => {
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
          fontFamily: "'Montserrat', 'Arial Black', 'Helvetica Neue', Arial, sans-serif",
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

export const Captions: React.FC<{ pages: CaptionPage[]; style: CaptionStyle }> = ({ pages, style }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {pages.map((page, i) => {
        const from = Math.round(page.start * fps);
        const duration = Math.max(1, Math.round(page.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            <Page page={page} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
