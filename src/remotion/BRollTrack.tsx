import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from "remotion";
import type { Shot } from "../types";

/** Plays each shot back-to-back, center-cropped to fill the vertical frame. */
export const BRollTrack: React.FC<{ shots: Shot[] }> = ({ shots }) => (
  <AbsoluteFill>
    {shots.map((shot, i) => (
      <Sequence key={i} from={shot.from} durationInFrames={shot.durationInFrames} layout="none">
        <AbsoluteFill>
          <OffthreadVideo
            src={staticFile(shot.src)}
            trimBefore={shot.trimBefore}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      </Sequence>
    ))}
  </AbsoluteFill>
);
