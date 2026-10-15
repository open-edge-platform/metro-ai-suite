// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import type { VssHit } from "@/adapters/vss/types";
import { useStoredQuery } from "@/hooks/queries";
import { hitsFromInline } from "@/lib/hits";
import type { InlineMatch } from "@/protocol/directives";
import { useInvestigationStore } from "@/stores/investigation";
import { groundingFor, groundingPending } from "@/stores/investigation.logic";

const NONE: VssHit[] = [];

export type HitSource = "vss" | "tool" | "inline" | "none";

/**
 * Hits behind a vsg-matches / vsg-track directive, most trusted first:
 *  1. the stored VSS query (id from the tool result, else the directive),
 *     used only when VSS actually knows it;
 *  2. the vss_search_video result in the session transcript;
 *  3. hits the agent copied inline.
 * `queryId` is set only once VSS confirmed it, so invented ids never reach
 * review keys or feedback.
 */
export function useDirectiveHits(
  data: { vss_query_id?: string; matches?: InlineMatch[] },
  turnId: string,
) {
  const grounded = useInvestigationStore((s) => groundingFor(s.turns, turnId));
  const pending = useInvestigationStore((s) =>
    groundingPending(s.turns, turnId),
  );
  const candidate = grounded?.queryId ?? data.vss_query_id;
  const query = useStoredQuery(pending ? undefined : candidate);
  const inline = useMemo(
    () => (data.matches?.length ? hitsFromInline(data.matches) : undefined),
    [data.matches],
  );

  const stored = query.data;
  const verifiedId = stored ? stored.queryId || candidate : undefined;
  const settled = !candidate || query.isError;
  let raw: VssHit[] = NONE;
  let source: HitSource = "none";
  if (stored) {
    raw = stored.hits;
    source = "vss";
  } else if (settled && grounded) {
    raw = grounded.hits;
    source = "tool";
  } else if (settled && inline) {
    raw = inline;
    source = "inline";
  }
  const hits = raw;

  return {
    hits,
    source,
    query: stored,
    queryId: verifiedId,
    isLoading: pending || (!!candidate && query.isLoading),
    isRunning: stored?.status === "running",
    error:
      source === "none" && candidate && query.isError
        ? (query.error as Error | null)
        : null,
    refetch: query.refetch,
  };
}
