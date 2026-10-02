# thebadcalls-video-engine

Turns a text script and a folder of B-roll into a finished vertical (1080×1920) MP4:

1. **Voiceover**: sends the script to ElevenLabs (`/text-to-speech/{voice}/with-timestamps`), which returns the MP3 along with timings for every character.
2. **Captions**: groups those character timings into words, then into short caption pages (3 words by default) that highlight each word as it's spoken. An `.srt` file is written next to the video.
3. **B-roll**: takes the clips in the folder in name order (`clip2` comes before `clip10`) and repeats them if the voiceover runs longer. Each cut lands on a sentence or clause break when one falls inside the allowed shot length.
4. **Render**: Remotion lays the shots out back to back, crops them to fill 9:16, adds the captions and voiceover, and renders an H.264 MP4.

## Setup

Requires Node 18+ (22 recommended).

```bash
npm install
cp .env.example .env   # then set ELEVENLABS_API_KEY
```

## Usage

```bash
npm run make -- --script examples/script.txt --broll ./my-broll --out out/video.mp4
```

| Flag | Default | |
|---|---|---|
| `--script <file>` | required | Script text file (`-` = stdin) |
| `--broll <dir>` | required | Folder of `.mp4/.mov/.m4v/.webm/.mkv` clips |
| `--out <file>` | `out/<script>.mp4` | Output path (the `.srt` file goes next to it) |
| `--voice <id>` | `$ELEVENLABS_VOICE_ID` or George | ElevenLabs voice ID |
| `--model <id>` | `eleven_multilingual_v2` | ElevenLabs model |
| `--speed <n>` | `1` | Voice speed (0.7 to 1.2) |
| `--words <n>` | `3` | Max words per caption |
| `--min-shot / --target-shot / --max-shot <sec>` | `1.5 / 3 / 5` | B-roll pacing |
| `--tail <sec>` | `0.5` | Time the video keeps running after the voice ends |
| `--no-render` | | Stop after writing `out/.work/<name>/props.json` |
| `--browser <path>` | `$REMOTION_BROWSER_EXECUTABLE` | Use an installed Chrome or headless shell |

Voiceovers are cached in `out/.work/<name>/voiceover/`, keyed by the script text and voice settings. If you re-render after changing B-roll, pacing or caption style, no ElevenLabs credits are used.

**Tweaking the look:** `npm run studio` opens Remotion Studio. To preview a real job, paste `out/.work/<name>/props.json` into the props editor. Caption styling defaults are in `DEFAULT_CAPTION_STYLE` in `src/types.ts`.

**Behind an HTTP proxy:** Node's `fetch` doesn't read `HTTPS_PROXY` by default. Run with `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24+).

## Layout

```
src/
  cli.ts                 # runs the four steps in order
  types.ts               # props shared by the pipeline and the composition
  pipeline/
    voiceover.ts         # ElevenLabs TTS with timestamps, cached
    captions.ts          # characters -> words -> caption pages, plus SRT output
    broll.ts             # clip discovery and planShots() (pure, unit tested)
    render.ts            # Remotion bundle, selectComposition and renderMedia
  remotion/
    Root.tsx             # 1080x1920 composition; duration comes from props
    VerticalVideo.tsx    # B-roll, legibility gradient, captions, audio
    BRollTrack.tsx       # OffthreadVideo per shot, objectFit: cover
    Captions.tsx         # pop-in caption pages with word highlight
```

`npm test` runs the unit tests and `npm run typecheck` runs `tsc`.

## Known limits / next steps

- ElevenLabs caps the length of a single request (about 5,000 to 10,000 characters depending on the model). Longer scripts will need to be split into chunks and joined.
- B-roll is played in folder order. Matching clips to the script by keyword or tag would be a natural next step.
- No background music track yet.
- Remotion is free for individuals and small teams. Larger companies need a [company license](https://www.remotion.dev/license).
