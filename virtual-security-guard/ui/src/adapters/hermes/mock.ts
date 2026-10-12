// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { MOCK_REPORT, scriptedReply } from "@/fixtures/argus";
import { serializeFeedback } from "@/protocol/feedback";
import { uid } from "@/lib/utils";
import type {
  HermesAdapter,
  HermesMessage,
  HermesSession,
  RunEvent,
} from "./types";

interface MockRun {
  id: string;
  input: string;
  sessionId?: string;
  cancelled: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

function seedPastSession(): {
  session: HermesSession;
  messages: HermesMessage[];
} {
  const t0 = Date.now() / 1000 - 3 * 3600;
  const msg = (
    role: HermesMessage["role"],
    content: string,
    dt: number,
  ): HermesMessage => ({ id: uid("msg"), role, content, timestamp: t0 + dt });
  const search = scriptedReply("Find a person in a blue jacket on Level 4");
  const trace = scriptedReply(
    serializeFeedback({
      queryId: "mock-q-search",
      confirm: ["m1"],
      reject: ["m7"],
    }),
  );
  const report = scriptedReply("Write a handover report");
  return {
    session: {
      id: "mock_session_past",
      title: "VSG · Person in blue jacket, Level 4",
      startedAt: t0,
      lastActive: t0 + 600,
      preview: MOCK_REPORT.summary.slice(0, 80),
      messageCount: 6,
    },
    messages: [
      msg("user", "Find a person in a blue jacket on Level 4", 0),
      msg("assistant", search.text, 40),
      msg(
        "user",
        serializeFeedback({
          queryId: "mock-q-search",
          confirm: ["m1"],
          reject: ["m7"],
        }),
        180,
      ),
      msg("assistant", trace.text, 220),
      msg("user", "Write a handover report", 500),
      msg("assistant", report.text, 560),
    ],
  };
}

/** Scripted Hermes: replays Argus' search → validate → trace → report loop. */
export function createMockHermes(
  opts: { delayMs?: number } = {},
): HermesAdapter {
  const delay = opts.delayMs ?? 18;
  const sessions = new Map<
    string,
    { session: HermesSession; messages: HermesMessage[] }
  >();
  const past = seedPastSession();
  sessions.set(past.session.id, past);
  const runs = new Map<string, MockRun>();

  return {
    async health() {
      return true;
    },
    async createSession(title) {
      const now = Date.now() / 1000;
      const session: HermesSession = {
        id: uid("mock_session"),
        title,
        startedAt: now,
        lastActive: now,
        messageCount: 0,
      };
      sessions.set(session.id, { session, messages: [] });
      return session;
    },
    async listSessions() {
      return [...sessions.values()]
        .map((s) => s.session)
        .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
    },
    async getMessages(id) {
      return sessions.get(id)?.messages ?? [];
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
    async startRun(req) {
      const id = uid("mock_run");
      runs.set(id, {
        id,
        input: req.input,
        sessionId: req.sessionId,
        cancelled: false,
      });
      return { runId: id };
    },
    async streamRun(runId, onEvent: (e: RunEvent) => void, signal) {
      const run = runs.get(runId);
      if (!run) return onEvent({ type: "failed", error: "Unknown run" });
      const reply = scriptedReply(run.input);
      let seq = 0;
      const live = () => !run.cancelled && !signal?.aborted;
      for (const t of reply.tools) {
        await sleep(delay * 10, signal);
        if (!live()) break;
        onEvent({
          type: "tool.started",
          seq: ++seq,
          tool: t.tool,
          preview: t.args,
        });
        await sleep(delay * 25, signal);
        if (!live()) break;
        onEvent({
          type: "tool.completed",
          seq: ++seq,
          tool: t.tool,
          preview: t.preview,
        });
      }
      let out = "";
      const chunks = reply.text.match(/[\s\S]{1,14}/g) ?? [];
      for (const c of chunks) {
        if (!live()) break;
        await sleep(delay, signal);
        out += c;
        onEvent({ type: "delta", seq: ++seq, text: c });
      }
      if (run.cancelled) {
        onEvent({ type: "cancelled", seq: ++seq });
      } else if (!signal?.aborted) {
        onEvent({ type: "completed", seq: ++seq, output: out });
      }
      const s = run.sessionId ? sessions.get(run.sessionId) : undefined;
      if (s) {
        const now = Date.now() / 1000;
        s.messages.push(
          { id: uid("msg"), role: "user", content: run.input, timestamp: now },
          { id: uid("msg"), role: "assistant", content: out, timestamp: now },
        );
        s.session.lastActive = now;
        s.session.messageCount = s.messages.length;
      }
    },
    async stopRun(runId) {
      const run = runs.get(runId);
      if (run) run.cancelled = true;
    },
  };
}
