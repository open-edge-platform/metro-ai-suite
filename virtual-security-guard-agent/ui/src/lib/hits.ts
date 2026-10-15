// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { VssHit } from "@/adapters/vss/types";
import type { InlineMatch } from "@/protocol/directives";
import { clipPathForVideo, toDatastorePath } from "@/lib/urls";

/** One VSS segment, independent of which query ranked it. */
export const segmentKey = (h: Pick<VssHit, "videoId" | "startS">) =>
  `${h.videoId}@${Math.round(h.startS)}`;

/**
 * Does an agent-supplied reference point at this hit? Small models do not
 * always copy `m<rank>` refs faithfully, so a video id or a segment key
 * (`<video_id>@<start_s>`) is accepted too.
 */
export function hitMatchesRef(h: VssHit, ref: string): boolean {
  const r = ref.trim().toLowerCase();
  if (!r) return false;
  return (
    r === h.matchId.toLowerCase() ||
    r === h.videoId.toLowerCase() ||
    r === segmentKey(h).toLowerCase()
  );
}

/**
 * Resolve agent refs to match ids. Returns undefined when there were no refs
 * or none of them matched, so callers fall back to "all hits" instead of
 * hiding everything behind a hallucinated id.
 */
export function resolveRefs(
  refs: readonly string[] | undefined,
  hits: readonly VssHit[],
): Set<string> | undefined {
  if (!refs?.length) return undefined;
  const out = new Set<string>();
  for (const h of hits)
    if (refs.some((r) => hitMatchesRef(h, r))) out.add(h.matchId);
  return out.size ? out : undefined;
}

/**
 * Lowest score a hit needs to count: the operator's minimum score (Settings)
 * as a fraction of the peak score among `hits`, so the cut-off holds whether
 * or not VSS normalised the result set.
 */
export function scoreCutoff(hits: readonly VssHit[], minScore: number): number {
  const peak = hits.reduce((m, h) => Math.max(m, h.score), 0);
  return peak * minScore;
}

/** Per-hit note from a `notes` map keyed by any accepted ref form. */
export function noteForHit(
  notes: Record<string, string> | undefined,
  h: VssHit,
): string | undefined {
  if (!notes) return undefined;
  for (const [ref, note] of Object.entries(notes))
    if (hitMatchesRef(h, ref)) return note;
  return undefined;
}

/**
 * Camera tag from a VSS clip name such as
 * `P_Lev_4_Main_Entry_ip_54-20140730-090000-chunk-005.mp4`.
 */
export function tagFromName(name: string | undefined): string | undefined {
  const m = name?.match(/^([A-Za-z0-9_]+?)-\d{8}-\d{6}/);
  return m?.[1];
}

/** Hits the agent copied inline into a directive (least trusted source). */
export function hitsFromInline(matches: InlineMatch[]): VssHit[] {
  return matches.map((m, i) => {
    const rank = m.match_id ? Number(m.match_id.slice(1)) || i + 1 : i + 1;
    const start = m.start_s ?? m.seek_s ?? 0;
    return {
      matchId: m.match_id ?? `m${rank}`,
      rank,
      videoId: m.video_id,
      videoName: m.video_name,
      cameraTag: m.camera,
      startS: start,
      endS: m.end_s ?? start + 8,
      seekS: m.seek_s ?? start,
      score: m.score ?? 0,
      playbackUrl: toDatastorePath(m.url) ?? clipPathForVideo(m.video_id),
    };
  });
}
