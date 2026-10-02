import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Effects, Shot, Word } from "../types";

/** Slow zoom drift across the shot, plus a quick zoom-in on the cut. Alternates direction per shot. */
const ShotVideo: React.FC<{ shot: Shot; index: number; kenBurns: boolean }> = ({ shot, index, kenBurns }) => {
  const frame = useCurrentFrame();
  let scale = 1;
  let x = 0;
  if (kenBurns) {
    const t = frame / Math.max(1, shot.durationInFrames - 1);
    const drift = index % 2 === 0 ? interpolate(t, [0, 1], [1.0, 1.08]) : interpolate(t, [0, 1], [1.08, 1.0]);
    const cut = interpolate(frame, [0, 7], [0.12, 0], {
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });
    // Every third shot also pans sideways; overscan a little so the edges stay covered.
    const pans = index % 3 === 1;
    scale = drift + cut + (pans ? 0.04 : 0);
    x = pans ? interpolate(t, [0, 1], [-20, 20]) : 0;
  }
  return (
    <AbsoluteFill style={{ transform: `translateX(${x}px) scale(${scale})` }}>
      <OffthreadVideo
        src={staticFile(shot.src)}
        trimBefore={shot.trimBefore}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};

/** Plays each shot back-to-back, center-cropped to fill the vertical frame. */
export const BRollTrack: React.FC<{ shots: Shot[]; emphasized: Word[]; effects: Effects }> = ({
  shots,
  emphasized,
  effects,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Punch in on the most recent emphasized word; alert words also shake the frame.
  let punch = 1;
  let shakeX = 0;
  let shakeY = 0;
  if (effects.punchIn) {
    const now = frame / fps;
    const hit = [...emphasized].reverse().find((w) => w.start <= now);
    if (hit) {
      const since = frame - Math.round(hit.start * fps);
      punch = 1 + interpolate(since, [0, 3, 14], [0, 0.07, 0], { extrapolateRight: "clamp" });
      if (hit.emphasis === "alert" && since < 10) {
        const amp = interpolate(since, [0, 10], [14, 0]);
        shakeX = Math.sin(since * 3.1) * amp;
        shakeY = Math.cos(since * 2.3) * amp * 0.6;
        punch = Math.max(punch, 1.03); // keep the frame edges covered while shaking
      }
    }
  }

  return (
    <AbsoluteFill style={{ transform: `translate(${shakeX}px, ${shakeY}px) scale(${punch})` }}>
      {shots.map((shot, i) => (
        <Sequence key={i} from={shot.from} durationInFrames={shot.durationInFrames} layout="none">
          <ShotVideo shot={shot} index={i} kenBurns={effects.kenBurns} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
