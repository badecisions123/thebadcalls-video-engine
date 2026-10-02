import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { PixabayHit } from "./stock";

// Remotion ships its own ffmpeg for every platform; `remotion ffmpeg ...` runs it,
// so nothing extra needs installing. Calling the CLI script through Node avoids
// shell quoting problems with paths that contain spaces (on Windows especially).
export const REMOTION_CLI = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@remotion/cli/package.json")),
  "remotion-cli.js",
);

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [REMOTION_CLI, "ffmpeg", "-v", "error", "-y", ...args], (err, _out, stderr) =>
      err ? reject(new Error(`ffmpeg failed: ${stderr || err.message}`)) : resolve(),
    );
  });
}

/**
 * Saves single frames at the given times (seconds) as small JPEGs. Remotion's
 * ffmpeg build only has a few filters (no fps/tile), so each frame is a seek.
 */
export async function extractFrames(video: string, outPrefix: string, times: number[], width = 320): Promise<string[]> {
  const files: string[] = [];
  for (const [i, t] of times.entries()) {
    const out = `${outPrefix}-${i}.jpg`;
    const tmp = `${out}.part.jpg`;
    await ffmpeg(["-ss", t.toFixed(2), "-i", video, "-vf", `scale=${width}:-2`, "-frames:v", "1", tmp]);
    await rename(tmp, out);
    files.push(out);
  }
  return files;
}

/** Frame times covering the part of a clip that plays on screen (its first few seconds). */
export function previewTimes(durationSeconds: number): number[] {
  const end = Math.max(0.1, Math.min(durationSeconds, 5) - 0.2);
  return [0.3, end / 2, end].map((t) => Math.min(t, end));
}

/**
 * Returns data URLs of frames from the start of the clip (what will actually
 * play), using its smallest rendition, cached. Undefined if anything fails.
 */
export async function clipPreview(hit: PixabayHit, cacheDir: string, doFetch: typeof fetch = fetch): Promise<string[] | undefined> {
  const renditions = Object.values(hit.videos).filter((r) => !!r?.url && r.width > 0);
  const smallest = renditions.sort((a, b) => a!.width - b!.width)[0];
  if (!smallest) return undefined;
  const dir = path.join(cacheDir, "previews");
  const video = path.join(dir, `${hit.id}-${smallest.width}.mp4`);
  const prefix = path.join(dir, `${hit.id}-frame`);
  const times = previewTimes(hit.duration);
  try {
    await mkdir(dir, { recursive: true });
    let files = times.map((_, i) => `${prefix}-${i}.jpg`);
    if (!files.every((f) => existsSync(f))) {
      if (!existsSync(video)) {
        const res = await doFetch(smallest.url);
        if (!res.ok) return undefined;
        await writeFile(video, Buffer.from(await res.arrayBuffer()));
      }
      files = await extractFrames(video, prefix, times);
    }
    return Promise.all(files.map(async (f) => `data:image/jpeg;base64,${(await readFile(f)).toString("base64")}`));
  } catch {
    return undefined;
  }
}
