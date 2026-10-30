// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAdapters } from "@/adapters";
import type { HermesSession } from "@/adapters/hermes/types";
import { env } from "@/config/env";
import { useCamerasStore } from "@/stores/cameras";
import { useInvestigationStore } from "@/stores/investigation";

export const qk = {
  health: ["health"] as const,
  tags: ["vss", "tags"] as const,
  streams: ["vss", "streams"] as const,
  sessions: (rev: number) => ["hermes", "sessions", rev] as const,
  messages: (id: string) => ["hermes", "messages", id] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: async () => {
      const { hermes, vss } = getAdapters();
      const [h, v] = await Promise.all([hermes.health(), vss.health()]);
      return { hermes: h, vss: v };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: qk.tags,
    queryFn: () => getAdapters().vss.listTags(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Every VSS camera tag: VSS's tag list plus the live streams' tags (a new
 * stream shows before the tag list refreshes). Undefined until VSS answers.
 */
export function useKnownTags(): string[] | undefined {
  const cameras = useCamerasStore((s) => s.cameras);
  const { data: vssTags } = useTags();
  return useMemo(
    () =>
      vssTags
        ? [...new Set([...cameras.map((c) => c.tag), ...vssTags])]
        : undefined,
    [cameras, vssTags],
  );
}

/** Sessions per page when looking for investigations. */
const SESSION_PAGE = 100;
/** Most pages read; a shared Hermes may hold many non-VSG sessions. */
const MAX_SESSION_PAGES = 5;

/**
 * Past investigations = Hermes sessions with the VSG title prefix. Hermes
 * can't filter by prefix, so pages are read (most recent first) until `limit`
 * investigations are found or the bounded page budget runs out.
 */
export function useInvestigations(limit = 50) {
  const revision = useInvestigationStore((s) => s.revision);
  return useQuery({
    queryKey: qk.sessions(revision),
    queryFn: async () => {
      const { hermes } = getAdapters();
      const found = new Map<string, HermesSession>();
      for (let page = 0; page < MAX_SESSION_PAGES; page++) {
        const { sessions, hasMore } = await hermes.listSessions({
          limit: SESSION_PAGE,
          offset: page * SESSION_PAGE,
        });
        for (const s of sessions)
          if (s.title.startsWith(env.sessionPrefix) && !found.has(s.id))
            found.set(s.id, {
              ...s,
              title: s.title.slice(env.sessionPrefix.length),
            });
        if (!hasMore || found.size >= limit) break;
      }
      return [...found.values()].slice(0, limit);
    },
    staleTime: 10_000,
  });
}
