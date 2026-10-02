import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeEmptySegments, planSegmentedShots, planShots } from "./broll";

const fps = 30;

function assertContiguous(shots: ReturnType<typeof planShots>, total: number) {
  let t = 0;
  for (const s of shots) {
    assert.equal(s.from, t);
    assert.ok(s.durationInFrames > 0);
    t += s.durationInFrames;
  }
  assert.equal(t, total);
}

test("covers the full duration, looping clips in order", () => {
  const clips = [
    { src: "a.mp4", durationInSeconds: 4 },
    { src: "b.mp4", durationInSeconds: 4 },
  ];
  const shots = planShots(clips, 20 * fps, [], { fps });
  assertContiguous(shots, 20 * fps);
  assert.deepEqual(shots.slice(0, 4).map((s) => s.src), ["a.mp4", "b.mp4", "a.mp4", "b.mp4"]);
});

test("never plays past the end of a source clip", () => {
  const clips = [{ src: "short.mp4", durationInSeconds: 1 }, { src: "long.mp4", durationInSeconds: 30 }];
  const shots = planShots(clips, 15 * fps, [], { fps });
  assertContiguous(shots, 15 * fps);
  for (const s of shots) {
    const clipFrames = (s.src === "short.mp4" ? 1 : 30) * fps;
    assert.ok(s.trimBefore + s.durationInFrames <= clipFrames, JSON.stringify(s));
  }
});

test("snaps cuts to sentence boundaries", () => {
  const clips = [{ src: "a.mp4", durationInSeconds: 10 }];
  const shots = planShots(clips, 10 * fps, [2.6, 6.1], { fps });
  assertContiguous(shots, 10 * fps);
  assert.deepEqual(shots.map((s) => s.from), [0, Math.round(2.6 * fps), Math.round(6.1 * fps)]);
});

test("avoids a tiny final shot", () => {
  const clips = [{ src: "a.mp4", durationInSeconds: 10 }];
  const shots = planShots(clips, Math.round(6.3 * fps), [], { fps, targetShot: 3, minShot: 1.5 });
  assertContiguous(shots, Math.round(6.3 * fps));
  assert.ok(shots[shots.length - 1].durationInFrames >= 1.5 * fps);
});

test("segmented plan keeps each segment's clips inside its time span", () => {
  const segments = [
    { start: 0, end: 4, clips: [{ src: "a.mp4", durationInSeconds: 10 }] },
    { start: 4, end: 9, clips: [{ src: "b1.mp4", durationInSeconds: 3 }, { src: "b2.mp4", durationInSeconds: 3 }] },
  ];
  const total = 10 * fps;
  const shots = planSegmentedShots(segments, total, [], { fps });
  assertContiguous(shots, total);
  for (const s of shots) {
    if (s.src === "a.mp4") assert.ok(s.from + s.durationInFrames <= 4 * fps);
    else assert.ok(s.from >= 4 * fps);
  }
  // The last segment stretches to the end of the video.
  assert.ok(shots[shots.length - 1].src.startsWith("b"));
});

test("segments without clips hand their time to a neighbour", () => {
  const c = [{ src: "x.mp4", durationInSeconds: 5 }];
  const merged = mergeEmptySegments([
    { start: 0, end: 2, clips: [] },
    { start: 2, end: 5, clips: c },
    { start: 5, end: 8, clips: [] },
    { start: 8, end: 10, clips: c },
  ]);
  assert.deepEqual(merged.map((s) => [s.start, s.end]), [[0, 8], [8, 10]]);
});
