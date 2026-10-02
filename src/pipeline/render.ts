import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION_ID, type VideoProps } from "../types";

const ENTRY_POINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../remotion/index.ts");

export type RenderOptions = {
  props: VideoProps;
  /** Directory served as Remotion's public dir; every `src` in props is relative to it. */
  publicDir: string;
  outputPath: string;
  browserExecutable?: string;
  concurrency?: number | null;
  onProgress?: (fraction: number) => void;
};

export async function renderVideo(opts: RenderOptions): Promise<void> {
  const serveUrl = await bundle({ entryPoint: ENTRY_POINT, publicDir: opts.publicDir });

  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: opts.props,
    browserExecutable: opts.browserExecutable,
  });

  await renderMedia({
    serveUrl,
    composition,
    inputProps: opts.props,
    codec: "h264",
    audioCodec: "aac",
    crf: 18,
    pixelFormat: "yuv420p",
    outputLocation: opts.outputPath,
    browserExecutable: opts.browserExecutable,
    concurrency: opts.concurrency ?? null,
    overwrite: true,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
}
