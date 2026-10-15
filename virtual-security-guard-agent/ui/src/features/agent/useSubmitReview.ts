// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { VssHit } from "@/adapters/vss/types";
import { splitVerdicts, useHitlStore } from "@/stores/hitl";
import { useInvestigationStore } from "@/stores/investigation";

/** e.g. `P_Lev_4_Main_Entry_ip_54, video <uuid>, 176-184 s` */
function clipLabel(h: VssHit): string {
  const parts = [
    h.cameraTag,
    `video ${h.videoId}`,
    `${Math.round(h.startS)}-${Math.round(h.endS)} s`,
  ];
  return parts.filter(Boolean).join(", ");
}

/**
 * Send the operator's verdicts to Argus, with readable clip labels so the
 * model can ground the refs it records.
 */
export function useSubmitReview(
  reviewKey: string,
  queryId: string | undefined,
  hits: VssHit[],
) {
  const [sending, setSending] = useState(false);
  const submitReview = useInvestigationStore((s) => s.submitReview);

  async function submit() {
    if (sending) return;
    setSending(true);
    try {
      const { confirm, reject } = splitVerdicts(
        useHitlStore.getState().verdicts[reviewKey],
      );
      const labels: Record<string, string> = {};
      for (const ref of [...confirm, ...reject]) {
        const h = hits.find((x) => x.matchId === ref);
        if (h) labels[ref] = clipLabel(h);
      }
      await submitReview(reviewKey, {
        confirmedHits: hits.filter((h) => confirm.includes(h.matchId)),
        queryId,
        labels,
      });
    } finally {
      setSending(false);
    }
  }

  return { submit, sending };
}
