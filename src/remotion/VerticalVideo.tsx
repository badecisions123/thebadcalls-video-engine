import { AbsoluteFill, Audio, staticFile } from "remotion";
import type { VideoProps } from "../types";
import { BRollTrack } from "./BRollTrack";
import { Captions } from "./Captions";

export const VerticalVideo: React.FC<VideoProps> = ({ audioSrc, shots, captions, captionStyle }) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <BRollTrack shots={shots} />
    {/* Darken the lower half slightly so captions stay legible on bright footage. */}
    <AbsoluteFill
      style={{
        background: "linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)",
      }}
    />
    <Captions pages={captions} style={captionStyle} />
    {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
  </AbsoluteFill>
);
