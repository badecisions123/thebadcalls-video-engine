import { type CalculateMetadataFunction, Composition } from "remotion";
import {
  COMPOSITION_ID,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_EFFECTS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoProps,
} from "../types";
import { VerticalVideo } from "./VerticalVideo";

// Placeholder props so `npm run studio` opens; real renders pass inputProps.
const defaultProps: VideoProps = {
  fps: 30,
  durationInFrames: 90,
  audioSrc: null,
  shots: [],
  captions: [
    {
      text: "Your captions here",
      start: 0,
      end: 3,
      words: [
        { text: "Your", start: 0, end: 0.6 },
        { text: "captions", start: 0.6, end: 1.6, emphasis: "key" },
        { text: "here", start: 1.6, end: 3 },
      ],
    },
  ],
  captionStyle: DEFAULT_CAPTION_STYLE,
  effects: DEFAULT_EFFECTS,
};

// Duration comes from the voiceover, so it's computed from props at render time.
const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => ({
  fps: props.fps,
  durationInFrames: Math.max(1, props.durationInFrames),
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={VerticalVideo}
    width={VIDEO_WIDTH}
    height={VIDEO_HEIGHT}
    fps={defaultProps.fps}
    durationInFrames={defaultProps.durationInFrames}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
