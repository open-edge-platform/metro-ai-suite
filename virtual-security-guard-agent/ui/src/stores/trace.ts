// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import type { VssHit } from "@/adapters/vss/types";
import { resolveRefs, scoreCutoff, segmentKey } from "@/lib/hits";
import { formatGap, hitTime } from "@/lib/time";
import { cameraName } from "./cameras";

export { segmentKey };

export interface TraceStop {
  hit: VssHit;
  /** 1-based position on the route. */
  order: number;
  /** Ingest time + segment start (see Q7: ingest-time ordering). */
  at?: Date;
}

export interface TraceOptions {
  /** Refs the agent kept (vsg-track.keep). When any resolve, only those are considered. */
  keep?: string[];
  /** Minimum score as a fraction of the peak score among `hits`. */
  minScore: number;
  /** Segment keys (`segmentKey`) the operator rejected anywhere in the investigation. */
  rejected?: Set<string>;
}

/**
 * Route = kept hits scoring at least minScore x the peak score, minus operator-rejected segments,
 * de-duplicated per segment and ordered by ingest time + start offset.
 */
export function buildTrace(hits: VssHit[], opts: TraceOptions): TraceStop[] {
  const keep = resolveRefs(opts.keep, hits);
  const cutoff = scoreCutoff(hits, opts.minScore);
  const seen = new Set<string>();
  const stops = hits
    .filter((h) => (keep ? keep.has(h.matchId) : true))
    .filter((h) => h.score >= cutoff)
    .filter((h) => !opts.rejected?.has(segmentKey(h)))
    .filter((h) => {
      const k = segmentKey(h);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((hit) => ({ hit, at: hitTime(hit) }));
  stops.sort((a, b) => {
    const ta = a.at?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = b.at?.getTime() ?? Number.POSITIVE_INFINITY;
    return ta - tb || a.hit.rank - b.hit.rank;
  });
  return stops.map((s, i) => ({ ...s, order: i + 1 }));
}

/** Collapse consecutive stops on the same camera into one map node visit. */
export function routeCameras(stops: TraceStop[]): string[] {
  const out: string[] = [];
  for (const s of stops) {
    const tag = s.hit.cameraTag;
    if (tag && out[out.length - 1] !== tag) out.push(tag);
  }
  return out;
}

export interface TraceSnapshot {
  turnId: string;
  queryId?: string;
  anchor?: string;
  stops: TraceStop[];
  createdAt: number;
}

interface TraceState {
  latest?: TraceSnapshot;
  setLatest: (t: TraceSnapshot | undefined) => void;
}

/** Most recent resolved trace, shared by the chat, Case File and Floorplan page. */
export const useTraceStore = create<TraceState>()((set) => ({
  latest: undefined,
  setLatest: (latest) => set({ latest }),
}));

/**
 * Live trace route: the confirmed sightings it started from, then every live
 * sighting the operator hasn't marked a false positive, in time order.
 */
export function buildLiveTrace(
  seed: VssHit[],
  sightings: VssHit[],
  isRejected: (h: VssHit) => boolean,
): TraceStop[] {
  const stops = [...seed, ...sightings.filter((h) => !isRejected(h))].map(
    (hit) => ({ hit, at: hitTime(hit) }),
  );
  stops.sort(
    (a, b) =>
      (a.at?.getTime() ?? Number.POSITIVE_INFINITY) -
      (b.at?.getTime() ?? Number.POSITIVE_INFINITY),
  );
  return stops.map((s, i) => ({ ...s, order: i + 1 }));
}

/** The subject's move between two consecutive stops on the route. */
export interface MovementLeg {
  from: TraceStop;
  to: TraceStop;
  /** Seconds between the two sightings, when both times are known. */
  gapS?: number;
  /** Seen again on the same camera rather than a move between cameras. */
  sameCamera: boolean;
}

/** Legs between consecutive stops of a time-ordered route. */
export function movementLegs(stops: TraceStop[]): MovementLeg[] {
  const out: MovementLeg[] = [];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    out.push({
      from,
      to,
      gapS:
        from.at && to.at
          ? (to.at.getTime() - from.at.getTime()) / 1000
          : undefined,
      sameCamera:
        !!from.hit.cameraTag && from.hit.cameraTag === to.hit.cameraTag,
    });
  }
  return out;
}

/** Route from confirmed sightings (any order): de-duplicated, time-ordered. */
export function routeFromSightings(hits: VssHit[]): TraceStop[] {
  return buildLiveTrace(uniqueSegments(hits), [], () => false);
}

/** First hit per VSS segment (the same clip can rank in several searches). */
export function uniqueSegments(hits: VssHit[]): VssHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = segmentKey(h);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * One line per confirmed sighting, in time order, with the movement from the
 * previous one. Sent to Argus so reports follow the subject's real timings.
 * `ref` is the segment key (`<video_id>@<start_s>`), unique across searches.
 */
export function timelineLines(
  stops: TraceStop[],
  name: (tag: string) => string = cameraName,
): string[] {
  return stops.map((s, i) => {
    const cam = s.hit.cameraTag ? name(s.hit.cameraTag) : "unknown camera";
    const when = s.at?.toISOString() ?? "unknown time";
    const prev = stops[i - 1];
    let move = "";
    if (prev) {
      const gap =
        prev.at && s.at
          ? formatGap((s.at.getTime() - prev.at.getTime()) / 1000)
          : "unknown time";
      const prevCam = prev.hit.cameraTag
        ? name(prev.hit.cameraTag)
        : "unknown camera";
      move =
        prevCam === cam
          ? `; still on ${cam}, ${gap} after stop ${prev.order}`
          : `; moved from ${prevCam} in ${gap}`;
    }
    return `${s.order}. ${when} ${cam} (ref ${segmentKey(s.hit)}, score ${s.hit.score.toFixed(2)})${move}`;
  });
}
