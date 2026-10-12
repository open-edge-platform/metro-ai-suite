// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { classifyPrompt } from "@/stores/investigation.logic";
import { parseSearchResult, parseWatchResult } from "./grounding";

const liveHit = {
  video_id: "785a615cca7a473bb5cc5335bf051005",
  source: "live",
  stream_id: "785a615cca7a473bb5cc5335bf051005",
  observed_at: "2026-05-01T10:00:04Z",
  seek_s: 4,
  score: 0.82,
  url: "http://gw/datastore/live-streams/785a/segments/1777000000.mp4",
  frame: {
    video_id: "785a615cca7a473bb5cc5335bf051005",
    timestamp: 4.2,
    media_path: "segments/1777000000.mp4",
    bucket_name: "live-streams",
    crop_bbox: "10,20,110,220",
  },
};

describe("live grounding", () => {
  it("maps live hits to stream camera, observed time and frame poster", () => {
    const g = parseSearchResult(
      JSON.stringify({ query_id: "q1", results: [liveHit] }) +
        "\nresource link: vss://frame",
    );
    const h = g!.hits[0];
    expect(h.source).toBe("live");
    expect(h.cameraTag).toBe(liveHit.stream_id);
    expect(h.observedAt).toBe(liveHit.observed_at);
    expect(h.posterUrl).toContain("/manager/frames?");
    expect(h.posterUrl).toContain("crop_bbox=10%2C20%2C110%2C220");
    expect(h.playbackUrl).toBe(
      "/vss/datastore/live-streams/785a/segments/1777000000.mp4",
    );
  });

  it("drops path-traversal frame locators", () => {
    const g = parseSearchResult(
      JSON.stringify({
        results: [
          { ...liveHit, frame: { ...liveHit.frame, media_path: "../x" } },
        ],
      }),
    );
    expect(g!.hits[0].frame?.mediaPath).toBeUndefined();
  });

  it("parses vss_watch_search results", () => {
    const w = parseWatchResult(
      `<untrusted_tool_result source="tool_call">${JSON.stringify({
        result: JSON.stringify({
          query_id: "abc-1",
          watch: true,
          expired: false,
          sightings: [liveHit],
          next_cursor: "c",
          poll_after_seconds: 10,
          expires_at: "2026-05-01T10:30:00Z",
        }),
      })}</untrusted_tool_result>`,
    );
    expect(w).toMatchObject({ queryId: "abc-1", watch: true, pollAfterS: 10 });
    expect(w!.sightings).toHaveLength(1);
    expect(parseWatchResult(JSON.stringify({ results: [] }))).toBeUndefined();
  });
});

describe("classifyPrompt", () => {
  it.each([
    ["Add camera rtsp://10.0.0.5:8554/lobby as Lobby", "streams"],
    ["remove the back alley camera", "streams"],
    ["list live streams", "streams"],
    ["Watch the live cameras for this person", "watch"],
    ["stop watching", "watch"],
    ["Find a person in a blue jacket", "search"],
    ["Write a handover report", "report"],
  ])("%s → %s", (text, kind) => {
    expect(classifyPrompt(text, false)).toBe(kind);
  });
});
