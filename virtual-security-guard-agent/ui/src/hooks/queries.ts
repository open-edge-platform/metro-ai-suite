// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAdapters } from "@/adapters";
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

/** Past investigations = Hermes sessions with the VSG title prefix. */
export function useInvestigations(limit = 50) {
  const revision = useInvestigationStore((s) => s.revision);
  return useQuery({
    queryKey: qk.sessions(revision),
    queryFn: async () => {
      const all = await getAdapters().hermes.listSessions(limit);
      return all
        .filter((s) => s.title.startsWith(env.sessionPrefix))
        .map((s) => ({ ...s, title: s.title.slice(env.sessionPrefix.length) }));
    },
    staleTime: 10_000,
  });
}
