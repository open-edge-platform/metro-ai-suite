// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import type { VssHit } from "@/adapters/vss/types";
import type { Verdict } from "./hitl";
import { useSettingsStore } from "./settings";

/**
 * Live trace: after the operator confirms a sighting, a watched VSS search
 * follows the subject on the live cameras and the route grows per sighting.
 *
 * A watch only starts on an operator action (confirming a sighting, or an
 * explicit chat request that Argus turns into vss_watch_search). Once running,
 * the UI polls the stored query over REST at VSS's refresh interval, so new
 * sightings cost no LLM tokens. Sightings are the watched query's live hits,
 * de-duplicated by camera and frame time.
 */

export type WatchStatus =
  "starting" | "watching" | "stopped" | "expired" | "idle-stopped" | "error";

export interface WatchSubject {
  query?: string;
  imageUrl?: string;
  previewUrl?: string;
  tags?: string[];
}

interface WatchState {
  queryId?: string;
  /** Who created the watched query; only UI-made queries are ours to stop on reset. */
  origin?: "ui" | "agent";
  sessionId?: string;
  subject?: WatchSubject;
  status?: WatchStatus;
  startedAt?: number;
  /** Absolute stop time (watch duration setting or the MCP's expires_at). */
  deadline?: number;
  lastSightingAt?: number;
  /** Operator-confirmed sightings the live trace starts from (route seed). */
  seed: VssHit[];
  /** Newest first. */
  sightings: VssHit[];
  verdicts: Record<string, Verdict>;
  error?: string;
  /** Confirmed sightings are saved and a live search is offered. */
  offered?: boolean;
  /** Offer declined for this session. */
  dismissed?: string;

  start: (
    subject: WatchSubject,
    sessionId?: string,
    seed?: VssHit[],
  ) => Promise<void>;
  /** Adopt a watch Argus started with vss_watch_search. */
  adopt: (
    queryId: string,
    opts: {
      sessionId?: string;
      subject?: WatchSubject;
      expiresAt?: string;
      sightings?: VssHit[];
      seed?: VssHit[];
    },
  ) => void;
  /** Offer a live search after the operator confirmed historical sightings. */
  offer: (
    subject: WatchSubject,
    sessionId: string | undefined,
    seed: VssHit[],
  ) => void;
  stop: (status?: WatchStatus) => Promise<void>;
  setVerdict: (key: string, v: Verdict | undefined) => void;
  dismiss: (sessionId: string) => void;
  clear: () => void;
}

/**
 * Live sightings the operator already confirmed in this session. They stay
 * on the route when another review round or a new live search starts.
 */
function confirmedLive(
  s: Pick<WatchState, "sessionId" | "sightings" | "verdicts">,
  sessionId: string | undefined,
): Pick<WatchState, "sightings" | "verdicts"> {
  if (!sessionId || s.sessionId !== sessionId)
    return { sightings: [], verdicts: {} };
  const sightings = s.sightings.filter(
    (h) => s.verdicts[sightingKey(h)] === "confirm",
  );
  const verdicts: Record<string, Verdict> = {};
  for (const h of sightings) verdicts[sightingKey(h)] = "confirm";
  return { sightings, verdicts };
}

export const sightingKey = (h: VssHit) =>
  `${h.streamId ?? h.videoId}@${h.observedAt ?? h.seekS}`;

/** Live matches refresh every 10 seconds. */
const POLL_MS = 10_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function stopTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  generation++;
}

export const useWatchStore = create<WatchState>()((set, get) => {
  function merge(fresh: VssHit[]) {
    const { sightings } = get();
    const seen = new Set(sightings.map(sightingKey));
    // The watched query only spans the last few minutes of live footage, so
    // every unseen live hit is a sighting; VSS and browser clocks may differ.
    const add = fresh.filter((h) => {
      if (h.source !== "live") return false;
      const k = sightingKey(h);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!add.length) return 0;
    add.sort(
      (a, b) => Date.parse(b.observedAt ?? "") - Date.parse(a.observedAt ?? ""),
    );
    set({
      sightings: [...add, ...sightings].slice(0, 200),
      lastSightingAt: Date.now(),
    });
    return add.length;
  }

  async function poll(gen: number, intervalMs: number) {
    if (gen !== generation) return;
    const { queryId, deadline, lastSightingAt, startedAt = Date.now() } = get();
    if (!queryId) return;
    const idleMs = useSettingsStore.getState().watchIdleMinutes * 60_000;
    if (deadline && Date.now() >= deadline) return void get().stop("expired");
    if (Date.now() - (lastSightingAt ?? startedAt) >= idleMs)
      return void get().stop("idle-stopped");
    try {
      const q = await getAdapters().vss.getQuery(queryId);
      if (gen !== generation) return;
      merge(q.hits);
      if (get().status === "starting") set({ status: "watching" });
    } catch (e) {
      if (gen !== generation) return;
      set({ error: (e as Error).message });
    }
    timer = setTimeout(() => void poll(gen, intervalMs), intervalMs);
  }

  function beginPolling() {
    stopTimer();
    const gen = generation;
    void poll(gen, POLL_MS);
  }

  return {
    seed: [],
    sightings: [],
    verdicts: {},

    offer(subject, sessionId, seed) {
      if (isWatchActive(get())) return;
      stopTimer();
      set({
        queryId: undefined,
        origin: undefined,
        sessionId,
        subject,
        status: undefined,
        offered: true,
        seed,
        ...confirmedLive(get(), sessionId),
        error: undefined,
      });
    },

    async start(subject, sessionId, seed = []) {
      if (get().status === "starting" || get().status === "watching") return;
      stopTimer();
      const minutes = useSettingsStore.getState().watchMinutes;
      const now = Date.now();
      set({
        queryId: undefined,
        origin: "ui",
        sessionId,
        subject,
        status: "starting",
        offered: false,
        startedAt: now,
        deadline: now + minutes * 60_000,
        lastSightingAt: undefined,
        seed,
        ...confirmedLive(get(), sessionId),
        error: undefined,
      });
      try {
        const queryId = await getAdapters().vss.startWatch({
          query: subject.imageUrl ? undefined : subject.query,
          imageUrl: subject.imageUrl,
          tags: subject.tags,
          windowMinutes: 5,
        });
        set({ queryId });
        beginPolling();
      } catch (e) {
        set({ status: "error", error: (e as Error).message });
      }
    },

    adopt(queryId, opts) {
      const cur = get();
      if (cur.queryId === queryId) {
        if (opts.sightings) merge(opts.sightings);
        return;
      }
      const now = Date.now();
      const minutes = useSettingsStore.getState().watchMinutes;
      const exp = opts.expiresAt ? Date.parse(opts.expiresAt) : NaN;
      set({
        queryId,
        origin: "agent",
        sessionId: opts.sessionId,
        subject: opts.subject,
        status: "watching",
        offered: false,
        startedAt: now,
        deadline: Number.isFinite(exp) ? exp : now + minutes * 60_000,
        lastSightingAt: undefined,
        seed: opts.seed ?? [],
        sightings: [],
        verdicts: {},
        error: undefined,
      });
      if (opts.sightings) merge(opts.sightings);
      void beginPolling();
    },

    async stop(status = "stopped") {
      stopTimer();
      const { queryId } = get();
      set({ status });
      if (queryId)
        await getAdapters()
          .vss.setWatch(queryId, false)
          .catch(() => undefined);
    },

    setVerdict(key, v) {
      set((s) => {
        const verdicts = { ...s.verdicts };
        if (v) verdicts[key] = v;
        else delete verdicts[key];
        return { verdicts };
      });
    },

    dismiss(sessionId) {
      set({ dismissed: sessionId, offered: false });
    },

    clear() {
      const { status } = get();
      if (status === "starting" || status === "watching") void get().stop();
      stopTimer();
      set({
        queryId: undefined,
        origin: undefined,
        sessionId: undefined,
        subject: undefined,
        status: undefined,
        offered: undefined,
        seed: [],
        sightings: [],
        verdicts: {},
        error: undefined,
        dismissed: undefined,
      });
    },
  };
});

export const isWatchActive = (s: { status?: WatchStatus }) =>
  s.status === "starting" || s.status === "watching";
