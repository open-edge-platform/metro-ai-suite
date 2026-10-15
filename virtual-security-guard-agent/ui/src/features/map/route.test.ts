// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { normalizeStoredQuery } from "@/adapters/vss/normalize";
import { declaredKeyMap } from "./keymap";
import { layoutRoute } from "./route";
import type { Floorplan } from "./schema";

const TAG = "P_Lev_4_External_Lift_foyer_ip_70";

/** One live result as GET /manager/search/:queryId returns it. */
const liveResult = (rank: number, videoId: string, tags?: string) => ({
  metadata: {
    rank,
    video_id: videoId,
    segment_start: 3.5,
    segment_end: 9.5,
    ...(tags && { tags }),
    video_metadata: tags ? { tags: [tags] } : {},
    best_frame_info: {
      is_live: true,
      video_id: videoId,
      timestamp: 5.5,
      media_path: "segments/1791969330.mp4",
      bucket_name: "live-streams",
    },
  },
});

const plan: Floorplan = {
  cameras: { [TAG]: { x: 10, y: 20 } },
};

describe("live hits are keyed by their VSS tag", () => {
  it("takes the camera tag from the search result, not the stream id", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "d85c146112d248a288a3674fe3e9ad11", TAG)],
    });
    expect(q.hits[0].cameraTag).toBe(TAG);
    expect(q.hits[0].streamId).toBe("d85c146112d248a288a3674fe3e9ad11");
  });

  it("falls back to the stream id when the hit has no tag", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "stream-x")],
    });
    expect(q.hits[0].cameraTag).toBe("stream-x");
  });

  it("places tagged live hits from different streams on one floorplan node", () => {
    const q = normalizeStoredQuery({
      queryId: "q1",
      results: [liveResult(1, "stream-a", TAG), liveResult(2, "stream-b", TAG)],
    });
    const stops = q.hits.map((hit, i) => ({ hit, order: i + 1 }));
    const route = layoutRoute(stops, plan, declaredKeyMap(plan, [TAG]));
    expect(route.offMap).toEqual([]);
    expect(route.visits).toHaveLength(1);
    expect(route.visits[0].orders).toEqual([1, 2]);
  });
});
