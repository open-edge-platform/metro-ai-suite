// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VssStoredQuery } from "@/adapters/vss/types";
import { qk } from "@/hooks/queries";
import { rejectedKeys, useHitlStore } from "@/stores/hitl";
import { useInvestigationStore } from "@/stores/investigation";
import { fallbackHitsFor } from "@/stores/investigation.logic";
import { segmentKey } from "@/stores/trace";

/**
 * Video segments the operator rejected anywhere in this investigation, so a
 * false positive never sneaks back into the route.
 */
export function useRejectedSegments(): Set<string> {
  const verdicts = useHitlStore((s) => s.verdicts);
  const turns = useInvestigationStore((s) => s.turns);
  const client = useQueryClient();
  // Serialised so transcript updates (streaming deltas) keep the same Set.
  const signature = useMemo(
    () =>
      [
        ...rejectedKeys({ verdicts }, (key, id) => {
          const hits = key.startsWith("inline:")
            ? fallbackHitsFor(turns, key.slice("inline:".length))
            : client.getQueryData<VssStoredQuery>(qk.query(key))?.hits;
          const hit = hits?.find((h) => h.matchId === id);
          return hit ? segmentKey(hit) : undefined;
        }),
      ]
        .sort()
        .join("\n"),
    [verdicts, turns, client],
  );
  return useMemo(
    () => new Set(signature ? signature.split("\n") : []),
    [signature],
  );
}
