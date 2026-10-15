// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { VssHit } from "@/adapters/vss/types";
import { formatGap } from "@/lib/time";
import { confirmedSightings, sameVerdicts } from "./hitl";
import { movementLegs, routeFromSightings, timelineLines } from "./trace";

const hit = (
  matchId: string,
  videoId: string,
  seekS: number,
  cameraTag = "cam-a",
): VssHit => ({
  matchId,
  rank: Number(matchId.slice(1)),
  videoId,
  cameraTag,
  startS: seekS,
  endS: seekS + 5,
  seekS,
  score: 0.8,
  ingestedAt: "2026-01-01T10:00:00Z",
});

describe("formatGap", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatGap(45)).toBe("45 s");
    expect(formatGap(185)).toBe("3 min 05 s");
    expect(formatGap(3720)).toBe("1 h 02 min");
    expect(formatGap(undefined)).toBe("unknown time");
  });
});

describe("sameVerdicts", () => {
  it("compares verdict maps by content", () => {
    expect(sameVerdicts({ m1: "confirm" }, { m1: "confirm" })).toBe(true);
    expect(sameVerdicts({ m1: "confirm" }, { m1: "reject" })).toBe(false);
    expect(sameVerdicts({ m1: "confirm" }, {})).toBe(false);
    expect(sameVerdicts(undefined, {})).toBe(true);
  });
});

describe("confirmedSightings", () => {
  it("unions confirms across grids, deduped by segment, in time order", () => {
    const a = [hit("m1", "v1", 120), hit("m2", "v2", 10)];
    const b = [hit("m1", "v1", 120), hit("m2", "v3", 60)];
    const out = confirmedSightings({
      verdicts: {
        q1: { m1: "confirm", m2: "confirm" },
        q2: { m1: "confirm", m2: "confirm" },
      },
      hits: { q1: a, q2: b },
    });
    expect(out.map((h) => `${h.videoId}@${h.seekS}`)).toEqual([
      "v2@10",
      "v3@60",
      "v1@120",
    ]);
  });

  it("ignores rejects and grids whose hits are not registered", () => {
    const out = confirmedSightings({
      verdicts: { q1: { m1: "reject" }, q2: { m1: "confirm" } },
      hits: { q1: [hit("m1", "v1", 0)] },
    });
    expect(out).toEqual([]);
  });
});

describe("movement", () => {
  const stops = routeFromSightings([
    hit("m1", "v2", 200, "cam-b"),
    hit("m2", "v1", 0, "cam-a"),
    hit("m3", "v3", 230, "cam-b"),
  ]);

  it("orders stops by time with gaps between them", () => {
    expect(stops.map((s) => s.hit.videoId)).toEqual(["v1", "v2", "v3"]);
    const legs = movementLegs(stops);
    expect(legs.map((l) => [l.gapS, l.sameCamera])).toEqual([
      [200, false],
      [30, true],
    ]);
  });

  it("writes timeline lines with refs and movement", () => {
    const lines = timelineLines(stops, (t) => t.toUpperCase());
    expect(lines[0]).toMatch(/^1\. 2026-01-01T10:00:00\.000Z CAM-A \(ref v1@0/);
    expect(lines[1]).toContain("moved from CAM-A in 3 min 20 s");
    expect(lines[2]).toContain("still on CAM-B, 30 s after stop 2");
  });
});
