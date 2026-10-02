import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractFrames, previewTimes } from "./frames";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "tiny.mp4");

test("previewTimes covers the first few seconds, within the clip", () => {
  assert.deepEqual(previewTimes(30), [0.3, 2.4, 4.8]);
  assert.ok(previewTimes(1).every((t) => t <= 0.8));
});

test("extractFrames uses Remotion's bundled ffmpeg to save JPEG frames", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "frames-"));
  try {
    const files = await extractFrames(fixture, path.join(dir, "f"), [0.3, 1.5, 3], 80);
    assert.equal(files.length, 3);
    for (const f of files) assert.equal((await readFile(f)).subarray(0, 2).toString("hex"), "ffd8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
