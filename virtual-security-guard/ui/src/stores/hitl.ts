// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { create } from "zustand";
import type { VssHit } from "@/adapters/vss/types";
import { segmentKey } from "@/lib/hits";
import { hitTime } from "@/lib/time";

export type Verdict = "confirm" | "reject";

export interface HitlState {
  /** reviewKey (VSS query id or `inline:<turnId>`) -> matchId -> verdict */
  verdicts: Record<string, Record<string, Verdict>>;
  /** The verdicts last sent to Argus per review key (absent = never sent). */
  sent: Record<string, Record<string, Verdict>>;
  /** Hits each review grid showed, so confirmations resolve to sightings. */
  hits: Record<string, VssHit[]>;
  setVerdict: (
    queryId: string,
    matchId: string,
    v: Verdict | undefined,
  ) => void;
  toggle: (queryId: string, matchId: string, v: Verdict) => void;
  /** Replace a grid's verdicts (e.g. implicit false positives on save). */
  replace: (queryId: string, verdicts: Record<string, Verdict>) => void;
  /** Record what was sent; with `verdicts`, also restore them (resume). */
  markSubmitted: (queryId: string, verdicts?: Record<string, Verdict>) => void;
  registerHits: (queryId: string, hits: VssHit[]) => void;
  clear: () => void;
}

export const useHitlStore = create<HitlState>()((set, get) => ({
  verdicts: {},
  sent: {},
  hits: {},
  setVerdict(queryId, matchId, v) {
    const cur = { ...(get().verdicts[queryId] ?? {}) };
    if (v) cur[matchId] = v;
    else delete cur[matchId];
    set({ verdicts: { ...get().verdicts, [queryId]: cur } });
  },
  toggle(queryId, matchId, v) {
    const cur = get().verdicts[queryId]?.[matchId];
    get().setVerdict(queryId, matchId, cur === v ? undefined : v);
  },
  replace(queryId, verdicts) {
    set({ verdicts: { ...get().verdicts, [queryId]: { ...verdicts } } });
  },
  markSubmitted(queryId, verdicts) {
    const snapshot = { ...(verdicts ?? get().verdicts[queryId] ?? {}) };
    set({
      sent: { ...get().sent, [queryId]: snapshot },
      ...(verdicts
        ? { verdicts: { ...get().verdicts, [queryId]: { ...verdicts } } }
        : {}),
    });
  },
  registerHits(queryId, hits) {
    if (get().hits[queryId] === hits) return;
    set({ hits: { ...get().hits, [queryId]: hits } });
  },
  clear: () => set({ verdicts: {}, sent: {}, hits: {} }),
}));

export function splitVerdicts(v: Record<string, Verdict> | undefined) {
  const confirm: string[] = [];
  const reject: string[] = [];
  for (const [id, verdict] of Object.entries(v ?? {}))
    (verdict === "confirm" ? confirm : reject).push(id);
  const byRank = (a: string, b: string) =>
    Number(a.slice(1)) - Number(b.slice(1));
  return { confirm: confirm.sort(byRank), reject: reject.sort(byRank) };
}

/** Same verdicts for the same matches. */
export function sameVerdicts(
  a: Record<string, Verdict> | undefined,
  b: Record<string, Verdict> | undefined,
): boolean {
  const ka = Object.keys(a ?? {});
  if (ka.length !== Object.keys(b ?? {}).length) return false;
  return ka.every((k) => a![k] === b?.[k]);
}

/**
 * Every sighting the operator confirmed in this session, across all review
 * grids: one entry per VSS segment, in the order the subject was seen.
 */
export function confirmedSightings(
  state: Pick<HitlState, "verdicts" | "hits">,
): VssHit[] {
  const bySegment = new Map<string, VssHit>();
  for (const [key, verdicts] of Object.entries(state.verdicts)) {
    const hits = state.hits[key];
    if (!hits) continue;
    for (const [id, v] of Object.entries(verdicts)) {
      if (v !== "confirm") continue;
      const h = hits.find((x) => x.matchId === id);
      if (h && !bySegment.has(segmentKey(h))) bySegment.set(segmentKey(h), h);
    }
  }
  return sortByTime([...bySegment.values()]);
}

/** Order hits by when they happened (unknown times last, then by rank). */
export function sortByTime(hits: VssHit[]): VssHit[] {
  const t = (h: VssHit) => hitTime(h)?.getTime() ?? Number.POSITIVE_INFINITY;
  return hits.slice().sort((a, b) => t(a) - t(b) || a.rank - b.rank);
}

/** Session-wide confirmed sightings in time order (stable between renders). */
export function useConfirmedSightings(): VssHit[] {
  const verdicts = useHitlStore((s) => s.verdicts);
  const hits = useHitlStore((s) => s.hits);
  return useMemo(
    () => confirmedSightings({ verdicts, hits }),
    [verdicts, hits],
  );
}

/** All rejected video segments across queries, to keep them out of traces. */
export function rejectedKeys(
  state: Pick<HitlState, "verdicts">,
  resolve: (queryId: string, matchId: string) => string | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const [q, m] of Object.entries(state.verdicts))
    for (const [id, v] of Object.entries(m))
      if (v === "reject") {
        const k = resolve(q, id);
        if (k) out.add(k);
      }
  return out;
}
