# thebadcalls-video-engine

Turns a text script and a folder of B-roll into a finished vertical (1080×1920) MP4:

1. **Voiceover**: sends the script to ElevenLabs (`/text-to-speech/{voice}/with-timestamps`), which returns the MP3 along with timings for every character.
2. **Captions**: groups those character timings into words, then into short caption pages (3 words by default). Each word pops in as it's spoken, and key words get called out (see below). An `.srt` file is written next to the video.
3. **B-roll**: takes the clips in the folder in name order (`clip2` comes before `clip10`) and repeats them if the voiceover runs longer. Each cut lands on a sentence or clause break when one falls inside the allowed shot length.
4. **Render**: Remotion lays the shots out back to back, crops them to fill 9:16, adds motion, captions, a progress bar and the voiceover, and renders an H.264 MP4.

## Caption styles

Pick one with `--caption-style`:

- **`whip`** (default): copies a CapCut caption, measured frame by frame from a reference clip. The whole caption appears on one line about 78% of the way down, in Montserrat Black, with keywords in yellow, green or red. The shadow is a thickened, blurred black copy of the text sitting slightly low, with no hard outline. Each caption snaps in from a wide horizontal stretch with heavy sideways motion blur over about 5 frames, and stretches back out the same way when it leaves.
- **`pop`**: words pop in as they're spoken and the current word turns yellow. Keywords get their own line, larger, with a bounce and glow. The bottom of the frame is darkened slightly behind the captions.

Montserrat is bundled (`@fontsource/montserrat`), so captions look the same on every machine. The presets live in `CAPTION_PRESETS` in `src/types.ts`.

## Emphasized words

Some words are colored to call them out. In the `pop` style they're also larger, get their own line and bounce in. In both styles the footage punches in when one is spoken:

| Tone | Color | Picked automatically for |
|---|---|---|
| alert | red, and the footage shakes | bad news: *bankrupt*, *fired*, *lawsuit*, *collapsed*, *lost*... (list in `src/pipeline/emphasis.ts`) |
| money | green | amounts, numbers and percentages: *$50*, *million*, *40%* |
| key | yellow | names (capitalized words mid-sentence, first mention only) and years |

To force a callout, wrap the words in asterisks in your script: `*Toys R Us* filed for *bankruptcy*`. The asterisks are removed before the script goes to ElevenLabs, and a marked word keeps its tone (so `*bankruptcy*` is still red). Use `--no-auto-emphasis` to call out only the words you've marked.

B-roll cuts are lined up with sentence breaks and with the moments emphasized words land.

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
| `--voice <id>` | `$ELEVENLABS_VOICE_ID` or Mark | ElevenLabs voice ID (default is "Mark - Natural Conversations", `UgBBYS2sOqTuMpoF3BR0`) |
| `--model <id>` | `eleven_multilingual_v2` | ElevenLabs model |
| `--speed <n>` | `1` | Voice speed (0.7 to 1.2) |
| `--words <n>` | `3` | Max words per caption |
| `--caption-style <name>` | `whip` | `whip` or `pop` (see above) |
| `--min-shot / --target-shot / --max-shot <sec>` | `1.5 / 3 / 5` | B-roll pacing |
| `--tail <sec>` | `0.5` | Time the video keeps running after the voice ends |
| `--no-auto-emphasis` | | Only call out words marked with `*asterisks*` |
| `--no-motion` | | Turn off the B-roll zooms, punch-ins and shake |
| `--no-progress` | | Hide the progress bar at the top |
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
    emphasis.ts          # *markers*, plus auto-detected names, money and bad-news words
    broll.ts             # clip discovery and planShots() (pure, unit tested)
    render.ts            # Remotion bundle, selectComposition and renderMedia
  remotion/
    Root.tsx             # 1080x1920 composition; duration comes from props
    VerticalVideo.tsx    # B-roll, legibility gradient, captions, progress bar, audio
    BRollTrack.tsx       # cover-cropped shots with zoom drift, cut zoom, punch-in and shake
    Captions.tsx         # "whip" and "pop" caption animations
    fonts.ts             # loads the bundled Montserrat Black before rendering
```

`npm test` runs the unit tests and `npm run typecheck` runs `tsc`.

## Known limits / next steps

- ElevenLabs caps the length of a single request (about 5,000 to 10,000 characters depending on the model). Longer scripts will need to be split into chunks and joined.
- B-roll is played in folder order. Matching clips to the script by keyword or tag would be a natural next step.
- No background music or sound effects yet. A whoosh or hit under emphasized words would add a lot, and ElevenLabs' sound-effects API could generate them once and reuse them.
- Remotion is free for individuals and small teams. Larger companies need a [company license](https://www.remotion.dev/license).
