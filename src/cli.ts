#!/usr/bin/env node
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { listClips, planShots } from "./pipeline/broll";
import { alignmentToWords, buildCaptionPages, sentenceBoundaries, toSrt } from "./pipeline/captions";
import { renderVideo } from "./pipeline/render";
import { generateVoiceover } from "./pipeline/voiceover";
import { DEFAULT_CAPTION_STYLE, type VideoProps } from "./types";

const USAGE = `
Usage: npm run make -- --script <file> --broll <dir> [options]

Required:
  --script <file>          Text file with the voiceover script ("-" reads stdin)
  --broll <dir>            Folder of B-roll clips (.mp4/.mov/.webm/...), used in name order

Options:
  --out <file>             Output MP4 (default: out/<script-name>.mp4)
  --voice <id>             ElevenLabs voice ID (default: $ELEVENLABS_VOICE_ID or George)
  --model <id>             ElevenLabs model ID (default: $ELEVENLABS_MODEL_ID or eleven_multilingual_v2)
  --speed <n>              Voice speed, 0.7-1.2 (default: 1)
  --fps <n>                Frames per second (default: 30)
  --words <n>              Max words per caption (default: 3)
  --min-shot <sec>         Min B-roll shot length (default: 1.5)
  --target-shot <sec>      Preferred B-roll shot length (default: 3)
  --max-shot <sec>         Max B-roll shot length (default: 5)
  --tail <sec>             Extra time after the voiceover ends (default: 0.5)
  --no-render              Generate voiceover/captions/plan only, skip the Remotion render
  --browser <path>         Chrome/headless-shell binary (default: $REMOTION_BROWSER_EXECUTABLE)
  -h, --help               Show this help
`;

async function readScript(file: string): Promise<string> {
  if (file === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(file, "utf8");
}

/** Hard-links (or copies, across devices) a file into the render's public dir. */
async function stage(src: string, dest: string) {
  await rm(dest, { force: true });
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const { values: args } = parseArgs({
    options: {
      script: { type: "string" },
      broll: { type: "string" },
      out: { type: "string" },
      voice: { type: "string" },
      model: { type: "string" },
      speed: { type: "string" },
      fps: { type: "string", default: "30" },
      words: { type: "string", default: "3" },
      "min-shot": { type: "string", default: "1.5" },
      "target-shot": { type: "string", default: "3" },
      "max-shot": { type: "string", default: "5" },
      tail: { type: "string", default: "0.5" },
      "no-render": { type: "boolean", default: false },
      browser: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (args.help || !args.script || !args.broll) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const fps = Number(args.fps);
  const name = args.script === "-" ? "video" : path.basename(args.script, path.extname(args.script));
  const outputPath = path.resolve(args.out ?? `out/${name}.mp4`);
  const workDir = path.resolve("out/.work", name);
  const publicDir = path.join(workDir, "public");
  await mkdir(publicDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  // 1) Voiceover
  const text = (await readScript(args.script)).trim();
  if (!text) throw new Error("Script is empty");
  console.log(`1/4 Generating voiceover (${text.length} chars)...`);
  if (!process.env.ELEVENLABS_API_KEY) {
    console.warn("    ! ELEVENLABS_API_KEY is not set; the request will likely be rejected.");
  }
  const vo = await generateVoiceover({
    text,
    voiceId: args.voice ?? process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
    modelId: args.model ?? process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
    speed: args.speed ? Number(args.speed) : undefined,
    apiKey: process.env.ELEVENLABS_API_KEY,
    outDir: path.join(workDir, "voiceover"),
  });
  console.log(`    ${vo.cached ? "Reused cached" : "Saved"} ${path.relative(process.cwd(), vo.audioPath)}`);

  // 2) Captions
  console.log("2/4 Building captions...");
  const words = alignmentToWords(vo.alignment);
  const captions = buildCaptionPages(words, { maxWords: Number(args.words) });
  const audioSeconds = Math.max(...vo.alignment.character_end_times_seconds);
  const srtPath = outputPath.replace(/\.mp4$/i, "") + ".srt";
  await writeFile(srtPath, toSrt(captions));
  console.log(`    ${words.length} words -> ${captions.length} captions, ${audioSeconds.toFixed(1)}s of audio`);

  // 3) B-roll
  console.log(`3/4 Planning B-roll from ${args.broll}...`);
  const clips = await listClips(args.broll);
  if (!clips.length) throw new Error(`No video clips found in ${args.broll}`);
  const staged = await Promise.all(
    clips.map(async (c, i) => {
      const src = `broll/${String(i).padStart(3, "0")}${path.extname(c.file).toLowerCase()}`;
      await mkdir(path.join(publicDir, "broll"), { recursive: true });
      await stage(c.file, path.join(publicDir, src));
      return { src, durationInSeconds: c.durationInSeconds };
    }),
  );
  await stage(vo.audioPath, path.join(publicDir, "voiceover.mp3"));

  const durationInFrames = Math.ceil((audioSeconds + Number(args.tail)) * fps);
  const shots = planShots(staged, durationInFrames, sentenceBoundaries(captions), {
    fps,
    minShot: Number(args["min-shot"]),
    targetShot: Number(args["target-shot"]),
    maxShot: Number(args["max-shot"]),
  });
  console.log(`    ${clips.length} clips -> ${shots.length} shots`);

  const props: VideoProps = {
    fps,
    durationInFrames,
    audioSrc: "voiceover.mp3",
    shots,
    captions,
    captionStyle: DEFAULT_CAPTION_STYLE,
  };
  await writeFile(path.join(workDir, "props.json"), JSON.stringify(props, null, 2));

  if (args["no-render"]) {
    console.log(`Skipping render. Props written to ${path.relative(process.cwd(), workDir)}/props.json`);
    return;
  }

  // 4) Render
  console.log("4/4 Rendering with Remotion...");
  let lastPct = -1;
  await renderVideo({
    props,
    publicDir,
    outputPath,
    browserExecutable: args.browser ?? process.env.REMOTION_BROWSER_EXECUTABLE,
    onProgress: (p) => {
      const pct = Math.floor(p * 100);
      if (pct >= lastPct + 10 || pct === 100) {
        lastPct = pct;
        console.log(`    ${pct}%`);
      }
    },
  });
  console.log(`Done: ${path.relative(process.cwd(), outputPath)} (+ ${path.basename(srtPath)})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
