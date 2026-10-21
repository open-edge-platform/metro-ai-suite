// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { VssHit } from "@/adapters/vss/types";
import { routeOf } from "./investigation.logic";
import { addHits, type LiveSighting } from "./liveTimeline";

/** A live hit on `camera` at 10:00 plus `s` seconds. */
const hit = (camera: string, s: number, score = 0.8): VssHit => ({
  matchId: `m${s}`,
  rank: 1,
  videoId: camera,
  streamId: camera,
  cameraTag: camera,
  source: "live",
  observedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString(),
  startS: 0,
  endS: 0,
  seekS: 0,
  score,
});
const at = (s: number) =>
  new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString();
const view = (xs: readonly LiveSighting[]) =>
  xs.map((x) => [x.camera, x.start, x.end, x.count]);

describe("addHits", () => {
  it("folds detections on one camera into a sighting within the gap", () => {
    let t = addHits([], "w1", [hit("cam_a", 10), hit("cam_a", 0)]);
    t = addHits(t, "w1", [hit("cam_a", 0), hit("cam_a", 10), hit("cam_a", 50)]);
    expect(view(t)).toEqual([["cam_a", at(0), at(50), 3]]);
  });

  it("starts a new sighting on another camera or after a gap over 60 s", () => {
    const t = addHits([], "w1", [
      hit("cam_a", 0),
      hit("cam_b", 5),
      hit("cam_a", 30),
      hit("cam_a", 95),
    ]);
    expect(view(t)).toEqual([
      ["cam_a", at(0), at(30), 2],
      ["cam_b", at(5), at(5), 1],
      ["cam_a", at(95), at(95), 1],
    ]);
  });

  it("keeps the best frame, ignores non-live hits, and never spans watches", () => {
    let t = addHits([], "w1", [hit("cam_a", 0, 0.5), hit("cam_a", 10, 0.9)]);
    expect(t[0].best.score).toBe(0.9);
    t = addHits(t, "w2", [
      hit("cam_a", 20),
      { ...hit("cam_b", 30), source: "video" },
    ]);
    expect(t.map((x) => [x.watch, x.count])).toEqual([
      ["w1", 2],
      ["w2", 1],
    ]);
  });

  it("returns the same array when a poll adds nothing", () => {
    const t = addHits([], "w1", [hit("cam_a", 0)]);
    expect(addHits(t, "w1", [hit("cam_a", 0)])).toBe(t);
  });
});

describe("live sightings on the route", () => {
  it("adds each confirmed sighting as one stop spanning start to end", () => {
    const t = addHits([], "w1", [
      hit("cam_a", 0),
      hit("cam_a", 40),
      hit("cam_b", 90),
    ]);
    const live = t.map((x, i) => ({ ...x, confirmed: i === 0 }));
    const stops = routeOf({ turns: [], reviews: {} }, live);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ detections: 2 });
    expect(stops[0].at?.toISOString()).toBe(at(0));
    expect(stops[0].until?.toISOString()).toBe(at(40));
  });
});
