import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionPage, CaptionStyle } from "../types";

const Page: React.FC<{ page: CaptionPage; style: CaptionStyle }> = ({ page, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Frame is relative to the page's Sequence; convert back to absolute seconds.
  const now = page.start + frame / fps;
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 220 }, durationInFrames: 8 });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: `${style.position * 100}%`,
          transform: `translateY(-50%) scale(${0.85 + 0.15 * pop})`,
          width: "86%",
          textAlign: "center",
          fontFamily: "'Montserrat', 'Arial Black', 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 900,
          fontSize: style.fontSize,
          lineHeight: 1.1,
          letterSpacing: -1,
          textTransform: style.uppercase ? "uppercase" : "none",
          WebkitTextStroke: `${Math.round(style.fontSize / 7)}px ${style.strokeColor}`,
          paintOrder: "stroke fill",
          textShadow: "0 6px 18px rgba(0,0,0,0.55)",
        }}
      >
        {page.words.map((w, i) => {
          const active = now >= w.start && now < w.end;
          return (
            <span key={i} style={{ color: active ? style.highlightColor : style.color }}>
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
            <Page page={page} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
