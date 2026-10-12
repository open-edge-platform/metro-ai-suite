// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { TraceStop } from "@/stores/trace";
import { invertKeyMap, type KeyMap } from "./keymap";
import type { Floorplan } from "./schema";

/** One stop on the drawn route: a run of consecutive sightings on the same camera. */
export interface MapVisit {
  /** 1-based number drawn in the marker. */
  index: number;
  tag: string;
  planKey: string;
  x: number;
  y: number;
  /** Marker position; offset from the node when the camera is revisited. */
  mx: number;
  my: number;
  /** Trace stop orders folded into this visit. */
  orders: number[];
  firstAt?: Date;
}

export interface RouteLayout {
  visits: MapVisit[];
  /** Sightings whose camera tag is not placed on the floorplan. */
  offMap: TraceStop[];
}

/**
 * Map ordered trace stops onto floorplan nodes. Consecutive stops on the same
 * camera collapse into one visit; revisits get their marker nudged around the
 * node so numbers stay readable.
 */
export function layoutRoute(
  stops: TraceStop[],
  plan: Floorplan,
  keyMap: KeyMap,
  nudge = 18,
): RouteLayout {
  const byTag = invertKeyMap(keyMap);
  const visits: MapVisit[] = [];
  const offMap: TraceStop[] = [];
  const seen = new Map<string, number>();
  for (const s of stops) {
    const tag = s.hit.cameraTag;
    const key = tag ? byTag.get(tag) : undefined;
    const cam = key ? plan.cameras[key] : undefined;
    if (!tag || !key || !cam) {
      offMap.push(s);
      continue;
    }
    const last = visits[visits.length - 1];
    if (last && last.planKey === key) {
      last.orders.push(s.order);
      continue;
    }
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const angle = -Math.PI / 4 + n * (Math.PI / 2.5);
    visits.push({
      index: visits.length + 1,
      tag,
      planKey: key,
      x: cam.x,
      y: cam.y,
      mx: n ? cam.x + nudge * Math.cos(angle) : cam.x,
      my: n ? cam.y + nudge * Math.sin(angle) : cam.y,
      orders: [s.order],
      firstAt: s.at,
    });
  }
  return { visits, offMap };
}
