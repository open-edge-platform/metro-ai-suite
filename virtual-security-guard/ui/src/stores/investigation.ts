// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { getAdapters } from "@/adapters";
import type { UploadedImage } from "@/adapters/vss/types";
import { env } from "@/config/env";
import { buildSearchInput, serializeFeedback } from "@/protocol/feedback";
import {
  groundingFromLatestRun,
  watchFromLatestRun,
} from "@/protocol/grounding";
import { buildInstructions } from "@/protocol/instructions";
import type { VssHit } from "@/adapters/vss/types";
import { extractDirectives } from "@/protocol/parser";
import { uid } from "@/lib/utils";
import { useCamerasStore } from "./cameras";
import { confirmedSightings, splitVerdicts, useHitlStore } from "./hitl";
import {
  activeQueryId,
  applyRunEvent,
  classifyPrompt,
  describeFeedback,
  fallbackHitsFor,
  groundingFor,
  inlineReviewKey,
  latestDirective,
  newAgentTurn,
  phaseFromTurns,
  reviewedTurnId,
  runningPhase,
  settleAfter,
  STOP_WATCH_RE,
  turnsFromMessages,
  type AgentTurn,
  type InvestigationPhase,
  type OperatorTurn,
  type Turn,
} from "./investigation.logic";
import { useSettingsStore } from "./settings";
import { routeFromSightings, timelineLines, useTraceStore } from "./trace";
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
  tags?: string[];
  start?: string;
  end?: string;
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
  /** Subject image for the whole investigation (first image search). */
  subjectImage?: { previewUrl: string; imageUrl: string };
  /** Bumped whenever a run settles, so history lists can refetch. */
  revision: number;

  send: (text: string, opts?: SearchOptions) => Promise<void>;
  /**
   * Replace the subject image (e.g. the operator cropped a person from a clip
   * and saved it to VSS). Records a short operator note so the subject persists
   * when the investigation is resumed, then the caller runs the follow-up search.
   */
  setSubject: (image: { previewUrl: string; imageUrl: string }) => void;
  /**
   * Send batched verdicts. `reviewKey` is the HITL store key: the VSS query id,
   * or `inline:<turnId>` when Argus returned matches inline.
   */
  submitReview: (
    reviewKey: string,
    opts: {
      queryId?: string;
      anchorImageUrl?: string;
      text?: string;
      /** The confirmed hits as the grid showed them (route seed). */
      confirmedHits?: VssHit[];
      /** Human-readable clip label per ref, so the model can ground "m3". */
      labels?: Record<string, string>;
    },
  ) => Promise<void>;
  retry: (agentTurnId: string) => Promise<void>;
  /** Operator asked to watch the live cameras for the current subject. */
  startWatch: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  resume: (sessionId: string) => Promise<void>;
}

let controller: AbortController | undefined;
/** Confirmed hits per feedback turn id, captured from the review grid. */
const confirmedByOp = new Map<string, VssHit[]>();

/** Verdicts of the latest review grid, whichever key it was stored under. */
function latestVerdicts(turns: Turn[]) {
  const all = useHitlStore.getState().verdicts;
  const m = latestDirective(turns, "matches");
  if (!m) return undefined;
  const keys = [
    groundingFor(turns, m.turnId)?.queryId,
    m.directive.data.vss_query_id,
    inlineReviewKey(m.turnId),
  ];
  for (const k of keys) if (k && all[k]) return all[k];
  return undefined;
}

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
   * Read the run's vss_search_video result from the session transcript so the
   * cards show what VSS actually returned, not ids the model copied.
   */
  async function ground(agentId: string, sessionId: string) {
    const turn = get().turns.find((t) => t.id === agentId);
    if (turn?.role !== "agent" || !turn.tools.length) return undefined;
    patchAgent(agentId, (t) => ({ ...t, grounding: true }));
    try {
      const messages = await getAdapters().hermes.getMessages(sessionId);
      const search = groundingFromLatestRun(messages);
      if (search) patchAgent(agentId, (t) => ({ ...t, search }));
      return messages;
    } catch {
      // keep directive / inline hits
      return undefined;
    } finally {
      patchAgent(agentId, (t) => ({ ...t, grounding: false }));
    }
  }

  /** What stage 2 watches for: the investigation's image, else its first description. */
  function watchSubject(): WatchSubject | undefined {
    const ops = get().turns.filter(
      (t): t is OperatorTurn => t.role === "operator" && t.kind === "search",
    );
    if (!ops.length) return undefined;
    const img = get().subjectImage;
    return {
      imageUrl: img?.imageUrl,
      previewUrl: img?.previewUrl,
      query: ops[0].text,
      tags: ops[ops.length - 1].scopeTags,
    };
  }

  /** Confirmed historical sightings of a feedback turn, and the live-search subject. */
  function traceFromFeedback(op: OperatorTurn) {
    if (op.kind !== "feedback") return undefined;
    const fb = extractDirectives(op.input).find((d) => d.type === "feedback");
    if (fb?.type !== "feedback" || !fb.data.confirm.length) return undefined;
    const turns = get().turns;
    const m = latestDirective(
      turns.slice(
        0,
        turns.findIndex((t) => t.id === op.id),
      ),
      "matches",
    );
    const hits = m ? fallbackHitsFor(turns, m.turnId) : [];
    // The route is every sighting confirmed in the session, in time order;
    // this review's hits are the fallback before any grid registered its hits.
    const session = confirmedSightings(useHitlStore.getState());
    const seed = session.length
      ? session
      : (confirmedByOp.get(op.id) ??
        hits.filter((h) => fb.data.confirm.includes(h.matchId)));
    // Live search reuses the operator's original photo or prompt.
    const base = watchSubject();
    const subject: WatchSubject = {
      ...base,
      previewUrl: base?.previewUrl ?? seed[0]?.posterUrl,
    };
    return { subject, seed };
  }

  /** After a run: refresh cameras, and follow any watch Argus started or stopped. */
  async function afterRun(
    op: OperatorTurn,
    messages: Awaited<ReturnType<typeof ground>>,
  ) {
    void useCamerasStore.getState().load();
    const watch = useWatchStore.getState();
    const w = messages ? watchFromLatestRun(messages) : undefined;
    const trace = traceFromFeedback(op);
    if (w) {
      if (w.watch && !w.expired)
        watch.adopt(w.queryId, {
          sessionId: get().sessionId,
          subject: trace?.subject ?? watchSubject(),
          expiresAt: w.expiresAt,
          sightings: w.sightings,
          seed: trace?.seed,
        });
      else if (watch.queryId === w.queryId && isWatchActive(watch))
        await watch.stop(w.expired ? "expired" : "stopped");
      return;
    }
    // Confirmed sightings are saved as the historical route; the live camera
    // search waits for the operator to accept the offer.
    if (trace) {
      if (!isWatchActive(watch))
        watch.offer(trace.subject, get().sessionId, trace.seed);
      return;
    }
    if (op.kind !== "watch") return;
    if (STOP_WATCH_RE.test(op.text)) {
      if (isWatchActive(watch)) await watch.stop();
    } else if (!isWatchActive(watch)) {
      const subject = watchSubject();
      if (subject) await watch.start(subject, get().sessionId, watch.seed);
    }
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
      subjectImage: s.subjectImage ?? op.image,
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
      const turns = get().turns;
      const qid = activeQueryId(turns);
      const { confirm, reject } = splitVerdicts(latestVerdicts(turns));
      const settings = useSettingsStore.getState();
      const instructions = buildInstructions({
        phase,
        cameras: useCamerasStore
          .getState()
          .cameras.map((c) => `${c.name} (${c.streamId}, ${c.status})`),
        watching: isWatchActive(useWatchStore.getState())
          ? useWatchStore.getState().queryId
          : undefined,
        scopeTags: op.scopeTags,
        activeQueryId: qid,
        confirmed: confirm,
        rejected: reject,
        sightings: timelineLines(
          routeFromSightings(confirmedSightings(useHitlStore.getState())),
        ),
        minScore: settings.minTraceScore,
        limit: settings.searchLimit,
      });
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
      const messages = await ground(agent.id, sessionId);
      await afterRun(op, messages);
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
          ? traceFromFeedback(op)
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

    setSubject(image) {
      // The crop becomes the subject. The follow-up search (sent by the caller)
      // records the image in the transcript, so on resume the subject is the
      // most recent searched photo, not the original. The preview is a
      // session-local blob; the VSS image URL is durable.
      set({
        subjectImage: {
          previewUrl: image.previewUrl,
          imageUrl: image.imageUrl,
        },
      });
    },

    async send(text, opts = {}) {
      const kind = classifyPrompt(text, !!opts.image);
      const settings = useSettingsStore.getState();
      const input =
        kind === "report" || kind === "streams" || kind === "watch"
          ? text.trim()
          : buildSearchInput({
              text,
              imageUrl: opts.image?.imageUrl,
              tags: opts.tags,
              start: opts.start,
              end: opts.end,
              limit: settings.searchLimit,
            });
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind,
        text: text.trim() || "Find this person in the recorded footage.",
        input,
        image: opts.image
          ? { previewUrl: opts.image.previewUrl, imageUrl: opts.image.imageUrl }
          : undefined,
        scopeTags: opts.tags?.length ? opts.tags : undefined,
        window:
          opts.start || opts.end
            ? { start: opts.start, end: opts.end }
            : undefined,
        createdAt: Date.now(),
      };
      const phase =
        kind === "streams" || kind === "watch"
          ? get().phase
          : runningPhase(kind, false);
      await run(op, phase);
    },

    async startWatch() {
      const watch = useWatchStore.getState();
      const subject = watch.subject ?? watchSubject();
      if (!subject) return;
      await watch.start(subject, get().sessionId, watch.seed);
    },

    async submitReview(reviewKey, opts) {
      if (get().busy) return;
      const hitl = useHitlStore.getState();
      const { confirm, reject } = splitVerdicts(hitl.verdicts[reviewKey]);
      hitl.markSubmitted(reviewKey);
      const queryId = opts.queryId;
      const op: OperatorTurn = {
        id: uid("op"),
        role: "operator",
        kind: "feedback",
        text: [describeFeedback(confirm, reject), opts.text?.trim()]
          .filter(Boolean)
          .join(" "),
        input: serializeFeedback({
          queryId,
          confirm,
          reject,
          anchorImageUrl: opts.anchorImageUrl,
          text: opts.text,
          labels: opts.labels,
        }),
        createdAt: Date.now(),
      };
      if (opts.confirmedHits?.length)
        confirmedByOp.set(op.id, opts.confirmedHits);
      await run(op, runningPhase("feedback", confirm.length > 0));
    },

    async retry(agentTurnId) {
      const turns = get().turns;
      const i = turns.findIndex((t) => t.id === agentTurnId);
      const op = turns[i - 1];
      if (i < 1 || !op || op.role !== "operator") return;
      set({ turns: turns.filter((_, k) => k !== i && k !== i - 1) });
      const fb = extractDirectives(op.input).find((d) => d.type === "feedback");
      await run(
        { ...op, id: uid("op"), createdAt: Date.now() },
        runningPhase(
          op.kind,
          fb?.type === "feedback" ? fb.data.confirm.length > 0 : false,
        ),
      );
    },

    async stop() {
      const runId = get().activeRunId;
      if (!runId) return;
      set({ stopping: true });
      try {
        await getAdapters().hermes.stopRun(runId);
      } catch {
        // fall through to aborting the stream locally
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
      useHitlStore.getState().clear();
      useTraceStore.getState().setLatest(undefined);
      set({
        sessionId: undefined,
        title: undefined,
        turns: [],
        phase: "idle",
        activeRunId: undefined,
        busy: false,
        stopping: false,
        subjectImage: undefined,
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
          hermes.listSessions(100).catch(() => []),
        ]);
        const turns = turnsFromMessages(messages);
        const hitl = useHitlStore.getState();
        turns.forEach((t, i) => {
          if (t.role !== "operator" || t.kind !== "feedback") return;
          const fb = extractDirectives(t.input).find(
            (d) => d.type === "feedback",
          );
          if (fb?.type !== "feedback") return;
          const reviewed = reviewedTurnId(turns, i);
          const key =
            fb.data.vss_query_id ??
            (reviewed ? inlineReviewKey(reviewed) : undefined);
          if (!key) return;
          const verdicts: Record<string, "confirm" | "reject"> = {};
          fb.data.confirm.forEach((r) => (verdicts[r] = "confirm"));
          fb.data.reject.forEach((r) => (verdicts[r] = "reject"));
          hitl.markSubmitted(key, verdicts);
        });
        const session = sessions.find((s) => s.id === sessionId);
        // Subject = the latest image the operator searched with (a crop
        // replaces the original photo), or the first photo otherwise.
        const lastImage = [...turns]
          .reverse()
          .find(
            (t): t is OperatorTurn => t.role === "operator" && !!t.image,
          )?.image;
        set({
          turns,
          phase: phaseFromTurns(turns),
          title:
            session?.title.replace(env.sessionPrefix, "") ?? "Investigation",
          subjectImage: lastImage,
        });
      } finally {
        set({ loadingSession: false });
      }
    },
  };
});

export const isRunningPhase = (p: InvestigationPhase) =>
  p === "searching" || p === "tracing" || p === "reporting";
