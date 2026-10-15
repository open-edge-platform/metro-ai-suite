// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/config/env";
import { createSseParser, isTerminal, toRunEvent } from "./sse";
import {
  HermesError,
  type HermesAdapter,
  type HermesMessage,
  type HermesSession,
  type RunEvent,
  type StartRunRequest,
} from "./types";

type Json = Record<string, unknown>;

async function request<T = Json>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = (body as Json | undefined)?.error;
    const msg =
      (err && typeof err === "object" && (err as Json).message) ||
      (typeof err === "string" ? err : undefined) ||
      `Hermes ${res.status} ${res.statusText}`;
    throw new HermesError(String(msg), res.status);
  }
  return body as T;
}

function toSession(s: Json): HermesSession {
  return {
    id: String(s.id),
    title: String(s.title ?? s.id),
    startedAt: typeof s.started_at === "number" ? s.started_at : undefined,
    lastActive: typeof s.last_active === "number" ? s.last_active : undefined,
    preview: typeof s.preview === "string" ? s.preview : undefined,
    messageCount:
      typeof s.message_count === "number" ? s.message_count : undefined,
  };
}

function contentToText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((p) =>
        typeof p === "string"
          ? p
          : p && typeof p === "object" && typeof (p as Json).text === "string"
            ? ((p as Json).text as string)
            : "",
      )
      .join("");
  return "";
}

function toMessage(m: Json, i: number): HermesMessage {
  const calls = Array.isArray(m.tool_calls) ? (m.tool_calls as Json[]) : [];
  return {
    id: String(m.id ?? i),
    role: (["user", "assistant", "tool", "system"].includes(String(m.role))
      ? m.role
      : "assistant") as HermesMessage["role"],
    content: contentToText(m.content),
    toolCalls: calls.map((c) => {
      const fn = (c.function ?? {}) as Json;
      return {
        id: typeof c.id === "string" ? c.id : undefined,
        name: String(fn.name ?? c.name ?? "tool"),
        arguments: typeof fn.arguments === "string" ? fn.arguments : undefined,
      };
    }),
    toolName: typeof m.tool_name === "string" ? m.tool_name : undefined,
    toolCallId: typeof m.tool_call_id === "string" ? m.tool_call_id : undefined,
    timestamp: typeof m.timestamp === "number" ? m.timestamp : undefined,
  };
}

const MAX_RECONNECTS = 3;

/**
 * Hermes API client. All calls go to the same-origin `/hermes` prefix; the
 * nginx BFF (or Vite dev proxy) adds the bearer token, so no secret ever
 * reaches the browser.
 */
export function createHttpHermes(base: string = env.hermesBase): HermesAdapter {
  async function readStream(
    runId: string,
    onEvent: (e: RunEvent) => void,
    signal: AbortSignal | undefined,
    lastId: string | undefined,
  ): Promise<{ terminal: boolean; lastId?: string }> {
    const res = await fetch(
      `${base}/v1/runs/${encodeURIComponent(runId)}/events`,
      {
        headers: {
          Accept: "text/event-stream",
          ...(lastId ? { "Last-Event-ID": lastId } : {}),
        },
        signal,
      },
    );
    if (!res.ok || !res.body)
      throw new HermesError(`Event stream failed (${res.status})`, res.status);
    let terminal = false;
    let id = lastId;
    const parser = createSseParser((msg) => {
      if (msg.id) id = msg.id;
      const ev = toRunEvent(msg);
      if (!ev) return;
      if (isTerminal(ev)) terminal = true;
      onEvent(ev);
    });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(value);
        if (terminal) break;
      }
      parser.end();
    } finally {
      reader.releaseLock();
    }
    return { terminal, lastId: id };
  }

  return {
    async health() {
      try {
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    },

    async createSession(title) {
      // Hermes requires unique titles; repeat prompts get " (2)", " (3)", ...
      for (let n = 1; ; n++) {
        const t = n === 1 ? title : `${title} (${n})`;
        try {
          const body = await request<Json>(base, "/api/sessions", {
            method: "POST",
            body: JSON.stringify({ title: t }),
          });
          return toSession((body.session ?? body) as Json);
        } catch (e) {
          if (n >= 20 || !/already in use/i.test((e as Error).message)) throw e;
        }
      }
    },

    async listSessions(limit = 50) {
      const body = await request<Json>(base, `/api/sessions?limit=${limit}`);
      const data = Array.isArray(body.data) ? (body.data as Json[]) : [];
      return data.map(toSession);
    },

    async getMessages(sessionId) {
      const body = await request<Json>(
        base,
        `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`,
      );
      const data = Array.isArray(body.data) ? (body.data as Json[]) : [];
      return data.map(toMessage);
    },

    async deleteSession(sessionId) {
      await request(base, `/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    },

    async startRun(req: StartRunRequest) {
      const body = await request<Json>(base, "/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          input: req.input,
          ...(req.sessionId ? { session_id: req.sessionId } : {}),
          ...(req.instructions ? { instructions: req.instructions } : {}),
        }),
      });
      if (typeof body.run_id !== "string")
        throw new HermesError("Hermes did not return a run id");
      return { runId: body.run_id };
    },

    async streamRun(runId, onEvent, signal) {
      let lastId: string | undefined;
      for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
        if (signal?.aborted) return;
        try {
          const r = await readStream(runId, onEvent, signal, lastId);
          if (r.terminal) return;
          lastId = r.lastId;
        } catch (e) {
          if (signal?.aborted) return;
          if (attempt === MAX_RECONNECTS) throw e;
        }
        // Stream closed without a terminal event: check the run before retrying.
        const status = await request<Json>(
          base,
          `/v1/runs/${encodeURIComponent(runId)}`,
          { signal },
        ).catch(() => undefined);
        const st = String(status?.status ?? "");
        if (st === "completed") {
          onEvent({
            type: "completed",
            output:
              typeof status?.output === "string" ? status.output : undefined,
          });
          return;
        }
        if (st === "cancelled") return onEvent({ type: "cancelled" });
        if (st === "failed") {
          return onEvent({
            type: "failed",
            error: String(status?.error ?? "The agent run failed."),
          });
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      onEvent({ type: "failed", error: "Lost connection to the agent." });
    },

    async stopRun(runId) {
      await request(base, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      });
    },
  };
}
