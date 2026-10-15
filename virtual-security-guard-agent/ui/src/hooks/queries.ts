// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useQuery } from "@tanstack/react-query";
import { getAdapters } from "@/adapters";
import { VssError, type VssStoredQuery } from "@/adapters/vss/types";
import { env } from "@/config/env";
import { useInvestigationStore } from "@/stores/investigation";

export const qk = {
  health: ["health"] as const,
  tags: ["vss", "tags"] as const,
  streams: ["vss", "streams"] as const,
  query: (id: string) => ["vss", "query", id] as const,
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

/** Stored VSS query; polls while VSS is still running it. */
export function useStoredQuery(queryId: string | undefined) {
  return useQuery<VssStoredQuery>({
    queryKey: qk.query(queryId ?? "none"),
    queryFn: () => getAdapters().vss.getQuery(queryId!),
    enabled: !!queryId,
    staleTime: 60_000,
    // Unknown or invented ids fail fast so the UI can fall back to the
    // transcript's tool result instead of spinning through retries.
    retry: (n, e) =>
      !(e instanceof VssError && e.status && e.status < 500) && n < 2,
    refetchInterval: (q) =>
      q.state.data && q.state.data.status === "running" ? 1500 : false,
  });
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

export function useSessionMessages(sessionId: string | undefined) {
  return useQuery({
    queryKey: qk.messages(sessionId ?? "none"),
    queryFn: () => getAdapters().hermes.getMessages(sessionId!),
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}
