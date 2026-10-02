import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { VideoProps } from "../types";
import { BRollTrack } from "./BRollTrack";
import { Captions } from "./Captions";

const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 12, background: "rgba(0,0,0,0.35)" }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 12,
          width: `${((frame + 1) / durationInFrames) * 100}%`,
          background: color,
        }}
      />
    </AbsoluteFill>
  );
};

export const VerticalVideo: React.FC<VideoProps> = ({ audioSrc, shots, captions, captionStyle, effects }) => {
  const emphasized = captions.flatMap((p) => p.words).filter((w) => w.emphasis);
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <BRollTrack shots={shots} emphasized={emphasized} effects={effects} />
      {/* "pop" captions rely on darkening the lower half; "whip" carries its own shadow. */}
      {captionStyle.animation === "pop" ? (
        <AbsoluteFill
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)",
          }}
        />
      ) : null}
      <Captions pages={captions} style={captionStyle} />
      {effects.progressBar ? <ProgressBar color={captionStyle.highlightColor} /> : null}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
