// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import type { UploadedImage } from "@/adapters/vss/types";
import { env } from "@/config/env";
import { uid } from "@/lib/utils";
import {
  buildSearchInput,
  IMAGE_ONLY_PROMPT,
  serializeFeedback,
} from "@/protocol/feedback";
import { groundingForRun } from "@/protocol/grounding";
import { buildInstructions } from "@/protocol/instructions";
import { extractDirectives } from "@/protocol/parser";
import { selectHasLiveCamera, useCamerasStore } from "./cameras";
import { splitVerdicts, type Review, type Verdict } from "./case";
import {
  cameraZone,
  freeFloorplanCameras,
  loadDefaultFloorplan,
} from "./floorplan";
import {
  applyRunEvent,
  classifyPrompt,
  confirmsSightings,
  describeFeedback,
  instructionContext,
  latestDirective,
  newAgentTurn,
  phaseFromTurns,
  reviewsFromTurns,
  routeOf,
  runningPhase,
  settleAfter,
  splitReportPrompt,
  subjectImageOf,
  subjectTextOf,
  turnsFromMessages,
  type AgentTurn,
  type InvestigationPhase,
  type OperatorTurn,
  type Turn,
} from "./investigation.logic";
import { useSettingsStore } from "./settings";
import { sessionSightings, useLiveTimelineStore } from "./liveTimeline";
import { isWatchActive, useWatchStore, type WatchSubject } from "./watch";

export type {
  AgentTurn,
  InvestigationPhase,
  OperatorTurn,
  ToolCallView,
  Turn,
} from "./investigation.logic";

export interface SearchOptions {
  image?: UploadedImage;
}

interface InvestigationState {
  sessionId?: string;
  title?: string;
  turns: Turn[];
  phase: InvestigationPhase;
  activeRunId?: string;
  busy: boolean;
  stopping: boolean;
  loadingSession: boolean;
  /** Bumped whenever a run settles, so history lists can refetch. */
  revision: number;
  /** Review state per grid, keyed by the agent turn that showed it. */
  reviews: Record<string, Review>;

  send: (text: string, opts?: SearchOptions) => Promise<void>;
  /** Change the latest grid's working verdicts (earlier grids are read-only). */
  setVerdicts: (turnId: string, verdicts: Record<string, Verdict>) => void;
  /**
   * Send the latest grid's verdicts (every shown match: confirm or reject).
   * They replace that grid's earlier verdicts.
   */
  submitReview: (
    turnId: string,
    verdicts: Record<string, Verdict>,
    opts: {
      queryId?: string;
      /** Human-readable clip label per ref, so the model can ground "m3". */
      labels?: Record<string, string>;
    },
  ) => Promise<void>;
  retry: (agentTurnId: string) => Promise<void>;
  /** Read an agent turn's search result from the transcript again. */
  reground: (agentTurnId: string) => Promise<void>;
  /** Operator asked to watch the live cameras for the current subject. */
  startWatch: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  resume: (sessionId: string) => Promise<void>;
}

let controller: AbortController | undefined;

/** The agent turn whose review grid the operator can still change. */
export function latestGridId(turns: Turn[]): string | undefined {
  return latestDirective(turns, "matches")?.turnId;
}

/** The session's live sightings, from the live timeline store. */
const liveOf = (sessionId: string | undefined) =>
  sessionSightings(useLiveTimelineStore.getState(), sessionId);

/** The session's route: confirmed sightings, de-duplicated, in time order. */
const routeNow = (
  s: Pick<InvestigationState, "turns" | "reviews" | "sessionId">,
) => routeOf(s, liveOf(s.sessionId));

function sessionTitle(text: string, hasImage: boolean) {
  const base =
    text.trim().replace(/\s+/g, " ") ||
    (hasImage ? "Image search" : "Investigation");
  return base.length > 64 ? `${base.slice(0, 61)}…` : base;
}

export const useInvestigationStore = create<InvestigationState>()((
  set,
  get,
) => {
  const patchAgent = (id: string, fn: (t: AgentTurn) => AgentTurn) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.id === id && t.role === "agent" ? fn(t) : t,
      ),
    }));

  /**
   * Read the run's vss_search_video result from the session transcript: the
   * grid shows only what VSS returned to Argus, never hits the model wrote.
   */
  async function ground(agentId: string) {
    const turns = get().turns;
    const i = turns.findIndex((t) => t.id === agentId);
    const turn = turns[i];
    const op = turns[i - 1];
    const sessionId = get().sessionId;
    if (turn?.role !== "agent" || !sessionId) return;
    // A grid needs its search result even if the tool events were lost.
    const hasGrid = extractDirectives(turn.text).some(
      (d) => d.type === "matches",
    );
    if (!turn.tools.length && !hasGrid) return;
    patchAgent(agentId, (t) => ({
      ...t,
      grounding: true,
      groundError: undefined,
    }));
    try {
      const messages = await getAdapters().hermes.getMessages(sessionId);
      const search = groundingForRun(
        messages,
        op?.role === "operator" ? op.input : undefined,
      );
      if (search) patchAgent(agentId, (t) => ({ ...t, search }));
      else if (hasGrid)
        patchAgent(agentId, (t) => ({
          ...t,
          groundError: "No vss_search_video result found in the transcript.",
        }));
    } catch (e) {
      patchAgent(agentId, (t) => ({
        ...t,
        groundError: (e as Error).message || "Request failed.",
      }));
    } finally {
      patchAgent(agentId, (t) => ({ ...t, grounding: false }));
    }
  }

  /** What the live search watches for: the latest image, else the latest prompt. */
  function watchSubject(): WatchSubject | undefined {
    const { turns } = get();
    const query = subjectTextOf(turns);
    if (!query) return undefined;
    const img = subjectImageOf(turns);
    return { imageUrl: img?.imageUrl, previewUrl: img?.previewUrl, query };
  }

  async function run(op: OperatorTurn, phase: InvestigationPhase) {
    if (get().busy) return;
    const { hermes } = getAdapters();
    const before =
      get().phase === "searching" ||
      get().phase === "tracing" ||
      get().phase === "reporting"
        ? "idle"
        : get().phase;
    const agent = newAgentTurn();
    set((s) => ({
      turns: [...s.turns, op, agent],
      busy: true,
      stopping: false,
      phase,
    }));
    try {
      let sessionId = get().sessionId;
      if (!sessionId) {
        const title = sessionTitle(op.text, !!op.image);
        const session = await hermes.createSession(
          `${env.sessionPrefix}${title}`,
        );
        sessionId = session.id;
        set({ sessionId, title });
      }
      const settings = useSettingsStore.getState();
      // Argus needs the plan to list the free camera positions.
      await loadDefaultFloorplan();
      const fleet = useCamerasStore.getState();
      const watch = useWatchStore.getState();
      const instructions = buildInstructions(
        instructionContext(
          {
            ...get(),
            live: liveOf(get().sessionId),
            phase,
            subject: watchSubject()?.query,
          },
          {
            fleet: { ...fleet, hasLiveCamera: selectHasLiveCamera(fleet) },
            freePositions: freeFloorplanCameras(fleet.cameras),
            watchingQueryId: isWatchActive(watch) ? watch.queryId : undefined,
            zone: cameraZone,
            minScore: settings.minTraceScore,
            limit: settings.searchLimit,
          },
        ),
      );
      const { runId } = await hermes.startRun({
        input: op.input,
        sessionId,
        instructions,
      });
      patchAgent(agent.id, (t) => ({ ...t, runId }));
      set({ activeRunId: runId });
      controller = new AbortController();
      await hermes.streamRun(
        runId,
        (ev) => patchAgent(agent.id, (t) => applyRunEvent(t, ev)),
        controller.signal,
      );
      await ground(agent.id);
      void useCamerasStore.getState().load();
    } catch (e) {
      patchAgent(agent.id, (t) =>
        t.status === "streaming"
          ? {
              ...t,
              status: "failed",
              error: (e as Error).message || "Request failed.",
            }
          : t,
      );
    } finally {
      controller = undefined;
      patchAgent(agent.id, (t) =>
        t.status === "streaming"
          ? { ...t, status: get().stopping ? "cancelled" : "done" }
          : t,
      );
      const final = get().turns.find((t) => t.id === agent.id) as
        AgentTurn | undefined;
      const settled =
        final && final.status === "done"
          ? confirmsSightings(op)
            ? "traced"
            : settleAfter(final.text, before)
          : before;
      set((s) => ({
        busy: false,
        stopping: false,
        activeRunId: undefined,
        phase: settled,
        revision: s.revision + 1,
      }));
    }
  }

  return {
    turns: [],
    phase: "idle",
    busy: false,
    stopping: false,
    loadingSession: false,
    revision: 0,
    reviews: {},

    async send(text, opts = {}) {
      const kind = classifyPrompt(text, !!opts.image);
      const settings = useSettingsStore.getState();
      const input =
        kind === "report" || kind === "streams"
          ? text.trim()
          : buildSearchInput({
              text,
              imageUrl: opts.image?.imageUrl,
              limit: settings.searchLimit,
            });
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind,
        ...(kind === "report"
          ? splitReportPrompt(text)
          : { text: text.trim() || IMAGE_ONLY_PROMPT }),
        input,
        image: opts.image
          ? { previewUrl: opts.image.previewUrl, imageUrl: opts.image.imageUrl }
          : undefined,
        createdAt: Date.now(),
      };
      const phase =
        kind === "streams" ? get().phase : runningPhase(kind, false);
      await run(op, phase);
    },

    async startWatch() {
      const { sessionId } = get();
      // Decided at Start, so Search again follows the latest image or prompt.
      const subject = watchSubject();
      if (!subject || !sessionId) return;
      // Without a photo, show the first confirmed sighting as the subject.
      await useWatchStore.getState().start(
        {
          ...subject,
          previewUrl: subject.previewUrl ?? routeNow(get())[0]?.hit.posterUrl,
        },
        sessionId,
      );
    },

    setVerdicts(turnId, verdicts) {
      if (turnId !== latestGridId(get().turns)) return;
      set((s) => ({
        reviews: { ...s.reviews, [turnId]: { ...s.reviews[turnId], verdicts } },
      }));
    },

    async submitReview(turnId, verdicts, opts) {
      if (get().busy || turnId !== latestGridId(get().turns)) return;
      const { confirm, reject } = splitVerdicts(verdicts);
      set((s) => ({
        reviews: { ...s.reviews, [turnId]: { verdicts, sent: verdicts } },
      }));
      const queryId = opts.queryId;
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind: "feedback",
        text: describeFeedback(confirm, reject),
        input: serializeFeedback({
          queryId,
          confirm,
          reject,
          labels: opts.labels,
        }),
        createdAt: Date.now(),
      };
      await run(op, runningPhase("feedback", confirm.length > 0));
    },

    async retry(agentTurnId) {
      const turns = get().turns;
      const i = turns.findIndex((t) => t.id === agentTurnId);
      const op = turns[i - 1];
      if (i < 1 || !op || op.role !== "operator") return;
      set({ turns: turns.filter((_, k) => k !== i && k !== i - 1) });
      await run(
        { ...op, id: uid("op"), createdAt: Date.now() },
        runningPhase(op.kind, confirmsSightings(op)),
      );
    },

    async reground(agentTurnId) {
      if (!get().busy) await ground(agentTurnId);
    },

    async stop() {
      const runId = get().activeRunId;
      if (!runId) return;
      set({ stopping: true });
      try {
        await getAdapters().hermes.stopRun(runId);
      } catch {
        // Release the UI now, but don't claim Hermes cancelled the run.
        set((s) => ({
          turns: s.turns.map((t) =>
            t.role === "agent" && t.runId === runId
              ? {
                  ...t,
                  status: "failed",
                  error:
                    "Couldn't stop Argus on Hermes. The run may still be finishing in the background.",
                }
              : t,
          ),
        }));
        controller?.abort();
        return;
      }
      // If Hermes never confirms the cancel, release the UI anyway.
      const pending = controller;
      setTimeout(() => {
        if (get().activeRunId === runId) pending?.abort();
      }, 4000);
    },

    reset() {
      controller?.abort();
      useWatchStore.getState().clear();
      set({
        sessionId: undefined,
        title: undefined,
        turns: [],
        phase: "idle",
        activeRunId: undefined,
        busy: false,
        stopping: false,
        reviews: {},
      });
    },

    async resume(sessionId) {
      if (get().busy || get().sessionId === sessionId) return;
      get().reset();
      set({ loadingSession: true, sessionId });
      try {
        const { hermes } = getAdapters();
        const [messages, sessions] = await Promise.all([
          hermes.getMessages(sessionId),
          hermes.listSessions(100),
        ]);
        const turns = turnsFromMessages(messages);
        const reviews = reviewsFromTurns(turns);
        const session = sessions.find((s) => s.id === sessionId);
        set({
          turns,
          phase: phaseFromTurns(turns),
          title: session?.title.replace(env.sessionPrefix, "") ?? sessionId,
          reviews,
        });
      } finally {
        set({ loadingSession: false });
      }
    },
  };
});
