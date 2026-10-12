// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { QueryClient } from "@tanstack/react-query";
import { getAdapters } from "@/adapters";
import type { VssHit } from "@/adapters/vss/types";
import { qk } from "@/hooks/queries";
import { hitMatchesRef, hitsFromInline } from "@/lib/hits";
import { extractDirectives } from "@/protocol/parser";
import {
  fallbackHitsFor,
  groundingFor,
  latestDirective,
  reviewedTurnId,
  turnsFromMessages,
} from "@/stores/investigation.logic";
import type { OperatorTurn } from "@/stores/investigation";
import { buildTrace, routeFromSightings, segmentKey } from "@/stores/trace";
import { toReportContent } from "./content";
import type { GenerateArgs } from "./useReportGenerator";

export class NoReportError extends Error {
  constructor() {
    super(
      "This investigation has no report draft yet. Open it in Argus and ask for one.",
    );
    this.name = "NoReportError";
  }
}

/**
 * Rebuild the inputs of an incident PDF from a past Hermes session: the last
 * vsg-report draft, every sighting the operator confirmed across the
 * session's review grids (in time order; older sessions fall back to the
 * last vsg-track route) and the subject image.
 */
export async function rebuildReportArgs(
  sessionId: string,
  qc: QueryClient,
  minScore: number,
): Promise<GenerateArgs> {
  const { hermes, vss } = getAdapters();
  const messages = await qc.fetchQuery({
    queryKey: qk.messages(sessionId),
    queryFn: () => hermes.getMessages(sessionId),
    staleTime: 60_000,
  });
  const turns = turnsFromMessages(messages);
  const report = latestDirective(turns, "report")?.directive.data;
  if (!report) throw new NoReportError();

  const hitsFor = (queryId: string) =>
    qc
      .fetchQuery({
        queryKey: qk.query(queryId),
        queryFn: () => vss.getQuery(queryId),
        staleTime: 60_000,
      })
      .then((q) => q.hits);
  const storedHits = (...ids: (string | undefined)[]) =>
    ids
      .filter((id): id is string => !!id)
      .reduce<Promise<VssHit[] | undefined>>(
        (acc, id) => acc.then((h) => h ?? hitsFor(id).catch(() => undefined)),
        Promise.resolve(undefined),
      );

  // A repeated vsg-feedback for the same grid replaces the earlier one, so
  // keep only the last verdicts per grid, then union them across the session.
  const lastFeedback = new Map<
    string,
    { confirm: string[]; reject: string[]; hits: VssHit[] }
  >();
  for (const [i, t] of turns.entries()) {
    if (t.role !== "operator" || t.kind !== "feedback") continue;
    const fb = extractDirectives(t.input).find((d) => d.type === "feedback");
    if (fb?.type !== "feedback") continue;
    const reviewed = reviewedTurnId(turns, i);
    const key = fb.data.vss_query_id ?? `inline:${reviewed ?? i}`;
    const hits =
      (await storedHits(fb.data.vss_query_id)) ??
      (reviewed ? fallbackHitsFor(turns, reviewed) : []);
    lastFeedback.set(key, {
      confirm: fb.data.confirm,
      reject: fb.data.reject,
      hits,
    });
  }
  const confirmed: VssHit[] = [];
  const rejected = new Set<string>();
  for (const fb of lastFeedback.values()) {
    const find = (ref: string) => fb.hits.find((x) => hitMatchesRef(x, ref));
    for (const ref of fb.confirm) {
      const h = find(ref);
      if (h) confirmed.push(h);
    }
    for (const ref of fb.reject) {
      const h = find(ref);
      if (h) rejected.add(segmentKey(h));
    }
  }
  // Confirmed in any grid wins over a reject in another grid.
  for (const h of confirmed) rejected.delete(segmentKey(h));

  let stops = routeFromSightings(confirmed);
  if (!stops.length) {
    // Older sessions: the last vsg-track route. Same order as the live
    // cards: verified stored query, transcript tool result, then the agent's
    // inline copy.
    const latestTrack = latestDirective(turns, "track");
    const track = latestTrack?.directive.data;
    if (latestTrack && track) {
      const grounded = groundingFor(turns, latestTrack.turnId);
      const hits =
        (await storedHits(grounded?.queryId, track.vss_query_id)) ??
        grounded?.hits ??
        (track.matches?.length ? hitsFromInline(track.matches) : []);
      stops = buildTrace(hits, { keep: track.keep, minScore, rejected });
    }
  }

  const subjectImage = turns.find(
    (t): t is OperatorTurn => t.role === "operator" && !!t.image,
  )?.image?.previewUrl;

  return { report: toReportContent(report), stops, subjectImage, sessionId };
}
