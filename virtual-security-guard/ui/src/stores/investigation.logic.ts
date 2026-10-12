// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { shortToolName } from "@/adapters/hermes/sse";
import type { HermesMessage, RunEvent } from "@/adapters/hermes/types";
import type { VssHit } from "@/adapters/vss/types";
import type { Directive } from "@/protocol/directives";
import {
  groundingFromMessage,
  type SearchGrounding,
} from "@/protocol/grounding";
import { extractDirectives, stripDirectives } from "@/protocol/parser";
import { hitsFromInline } from "@/lib/hits";
import { toDatastorePath } from "@/lib/urls";
import { uid } from "@/lib/utils";

export type InvestigationPhase =
  "idle" | "searching" | "validating" | "tracing" | "traced" | "reporting";

export interface ToolCallView {
  id: string;
  tool: string;
  name: string;
  args?: string;
  preview?: string;
  status: "running" | "done" | "error";
}

export interface OperatorTurn {
  id: string;
  role: "operator";
  kind: "search" | "feedback" | "report" | "streams" | "watch";
  /** What the operator sees in the transcript. */
  text: string;
  /** Exact run input sent to Hermes. */
  input: string;
  image?: { previewUrl: string; imageUrl: string };
  scopeTags?: string[];
  window?: { start?: string; end?: string };
  createdAt: number;
}

export interface AgentTurn {
  id: string;
  role: "agent";
  runId?: string;
  text: string;
  reasoning: string;
  tools: ToolCallView[];
  status: "streaming" | "done" | "cancelled" | "failed";
  error?: string;
  createdAt: number;
  /** Rebuilt from session history rather than streamed. */
  replayed?: boolean;
  /** Latest vss_search_video result of this run, read from the transcript. */
  search?: SearchGrounding;
  /** True while the transcript is being fetched after the run. */
  grounding?: boolean;
}

export type Turn = OperatorTurn | AgentTurn;

export function newAgentTurn(): AgentTurn {
  return {
    id: uid("agent"),
    role: "agent",
    text: "",
    reasoning: "",
    tools: [],
    status: "streaming",
    createdAt: Date.now(),
  };
}

/** Pure reducer: fold one Hermes run event into the streaming agent turn. */
export function applyRunEvent(t: AgentTurn, ev: RunEvent): AgentTurn {
  switch (ev.type) {
    case "delta":
      return { ...t, text: t.text + ev.text };
    case "reasoning":
      return { ...t, reasoning: t.reasoning + ev.text };
    case "tool.started":
      return {
        ...t,
        tools: [
          ...t.tools,
          {
            id: uid("tool"),
            tool: ev.tool,
            name: shortToolName(ev.tool),
            args: ev.preview,
            status: "running",
          },
        ],
      };
    case "tool.completed": {
      const tools = [...t.tools];
      let i = -1;
      for (let k = tools.length - 1; k >= 0; k--)
        if (tools[k].tool === ev.tool && tools[k].status === "running") {
          i = k;
          break;
        }
      const done: ToolCallView = {
        ...(i >= 0
          ? tools[i]
          : { id: uid("tool"), tool: ev.tool, name: shortToolName(ev.tool) }),
        preview: ev.preview,
        status: ev.error ? "error" : "done",
      };
      if (i >= 0) tools[i] = done;
      else tools.push(done);
      return { ...t, tools };
    }
    case "completed":
      return {
        ...t,
        status: "done",
        text: t.text || ev.output || "",
        tools: closeTools(t.tools),
      };
    case "failed":
      return {
        ...t,
        status: "failed",
        error: ev.error,
        tools: closeTools(t.tools),
      };
    case "cancelled":
      return { ...t, status: "cancelled", tools: closeTools(t.tools) };
    default:
      return t;
  }
}

function closeTools(tools: ToolCallView[]): ToolCallView[] {
  return tools.map((x) =>
    x.status === "running" ? { ...x, status: "done" } : x,
  );
}

/**
 * Phase after an agent reply finished, driven by the directives it emitted.
 * Without a matches/track block the investigation returns to where it was
 * before the run (e.g. a report keeps the "traced" state).
 */
export function settleAfter(
  text: string,
  before: InvestigationPhase,
): InvestigationPhase {
  const ds = extractDirectives(text);
  if (ds.some((d) => d.type === "track")) return "traced";
  if (ds.some((d) => d.type === "matches")) return "validating";
  return before;
}

/** Phase while a run for this kind of operator turn is in flight. */
export function runningPhase(
  kind: OperatorTurn["kind"],
  hasConfirms: boolean,
): InvestigationPhase {
  if (kind === "report") return "reporting";
  if (kind === "streams" || kind === "watch") return "idle";
  if (kind === "feedback") return hasConfirms ? "tracing" : "searching";
  return "searching";
}

const REPORT_RE =
  /\b(report|handover|hand-over|escalat\w*|incident (pdf|summary)|write ?up)\b/i;

/** Camera management: add/remove/pause/list streams, or any RTSP URL. */
const STREAMS_RE =
  /rtsps?:\/\/|\b(add|remove|delete|pause|resume|rename|list|show)\b[^.?!]{0,40}\b(cameras?|streams?|feeds?)\b/i;
/** Start or stop watching the live cameras (explicit operator request). */
export const WATCH_RE =
  /\b(watch|monitor|keep (an eye|looking|watching)|alert me)\b[^.?!]{0,40}\b(live|cameras?|feeds?|streams?)\b|\bstop (the )?(watch|watching|monitoring)\b/i;
export const STOP_WATCH_RE =
  /\b(stop|end|cancel)\b[^.?!]{0,20}\b(watch|watching|monitor\w*)\b/i;

export function classifyPrompt(
  text: string,
  hasImage: boolean,
): OperatorTurn["kind"] {
  if (!hasImage && WATCH_RE.test(text)) return "watch";
  if (!hasImage && STREAMS_RE.test(text)) return "streams";
  if (!hasImage && REPORT_RE.test(text)) return "report";
  return "search";
}

/**
 * Stored VSS query id of the latest search result. Only ids that came from a
 * real tool result count; ids the model wrote are never echoed back to it.
 */
export function activeQueryId(turns: Turn[]): string | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === "agent" && t.search?.queryId) return t.search.queryId;
  }
  return undefined;
}

/**
 * Search grounding for the directives of `turnId`: its own search result, or
 * the nearest earlier one (e.g. a vsg-track that re-ranks the previous search).
 * Returns the stored object so zustand selectors stay referentially stable.
 */
export function groundingFor(
  turns: Turn[],
  turnId: string,
): SearchGrounding | undefined {
  const i = turns.findIndex((t) => t.id === turnId);
  for (let k = i; k >= 0; k--) {
    const t = turns[k];
    if (t.role === "agent" && t.search) return t.search;
  }
  return undefined;
}

/** True while `turnId` may still gain grounding (streaming or fetching it). */
export function groundingPending(turns: Turn[], turnId: string): boolean {
  const t = turns.find((x) => x.id === turnId);
  return t?.role === "agent" && (t.status === "streaming" || !!t.grounding);
}

/**
 * Non-stored hits behind an agent turn's latest matches/track directive:
 * transcript grounding first, then the agent's inline copy.
 */
export function fallbackHitsFor(turns: Turn[], turnId: string): VssHit[] {
  const g = groundingFor(turns, turnId);
  if (g?.hits.length) return g.hits;
  const t = turns.find((x) => x.id === turnId);
  if (t?.role !== "agent") return [];
  const d = extractDirectives(t.text)
    .reverse()
    .find((x) => x.type === "matches" || x.type === "track");
  return d && (d.type === "matches" || d.type === "track") && d.data.matches
    ? hitsFromInline(d.data.matches)
    : [];
}

/** Review key the HITL store uses for a grid: verified query id or the turn. */
export const inlineReviewKey = (turnId: string) => `inline:${turnId}`;

/** Agent turn whose vsg-matches grid an operator feedback turn reviewed. */
export function reviewedTurnId(
  turns: Turn[],
  feedbackIndex: number,
): string | undefined {
  for (let k = feedbackIndex - 1; k >= 0; k--) {
    const t = turns[k];
    if (
      t.role === "agent" &&
      extractDirectives(t.text).some((d) => d.type === "matches")
    )
      return t.id;
  }
  return undefined;
}

export function latestDirective<T extends Directive["type"]>(
  turns: Turn[],
  type: T,
): { turnId: string; directive: Extract<Directive, { type: T }> } | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role !== "agent") continue;
    const ds = extractDirectives(t.text).filter((d) => d.type === type);
    if (ds.length)
      return {
        turnId: t.id,
        directive: ds[ds.length - 1] as Extract<Directive, { type: T }>,
      };
  }
  return undefined;
}

export function describeFeedback(confirm: string[], reject: string[]): string {
  const parts: string[] = [];
  if (confirm.length) parts.push(`Confirmed ${confirm.join(", ")}.`);
  if (reject.length)
    parts.push(`Marked ${reject.join(", ")} as false positives.`);
  if (!confirm.length) parts.push("None are the right person.");
  return parts.join(" ");
}

/**
 * Rebuild a transcript from Hermes session history. Consecutive assistant and
 * tool messages (one run) fold into a single agent turn.
 */
export function turnsFromMessages(messages: HermesMessage[]): Turn[] {
  const turns: Turn[] = [];
  let agent: AgentTurn | undefined;
  for (const m of messages) {
    const ts = m.timestamp ? m.timestamp * 1000 : Date.now();
    if (m.role === "user") {
      agent = undefined;
      const ds = extractDirectives(m.content);
      const fb = ds.find((d) => d.type === "feedback");
      const ctx = ds.find((d) => d.type === "context");
      const prose = stripDirectives(m.content);
      const kind: OperatorTurn["kind"] = fb
        ? "feedback"
        : classifyPrompt(
            prose,
            !!(ctx?.type === "context" && ctx.data.image_url),
          );
      const imageUrl = ctx?.type === "context" ? ctx.data.image_url : undefined;
      const preview = imageUrl ? toDatastorePath(imageUrl) : undefined;
      turns.push({
        id: uid("op"),
        role: "operator",
        kind,
        text:
          fb?.type === "feedback"
            ? describeFeedback(fb.data.confirm, fb.data.reject)
            : prose,
        input: m.content,
        image:
          imageUrl && preview ? { imageUrl, previewUrl: preview } : undefined,
        scopeTags: ctx?.type === "context" ? ctx.data.tags : undefined,
        window:
          ctx?.type === "context" && (ctx.data.start || ctx.data.end)
            ? { start: ctx.data.start, end: ctx.data.end }
            : undefined,
        createdAt: ts,
      });
      continue;
    }
    if (m.role === "system") continue;
    if (!agent) {
      agent = {
        ...newAgentTurn(),
        status: "done",
        replayed: true,
        createdAt: ts,
      };
      turns.push(agent);
    }
    if (m.role === "assistant") {
      if (m.content.trim())
        agent.text = agent.text ? `${agent.text}\n\n${m.content}` : m.content;
      for (const c of m.toolCalls ?? [])
        agent.tools.push({
          id: c.id ?? uid("tool"),
          tool: c.name,
          name: shortToolName(c.name),
          args: c.arguments,
          status: "done",
        });
    } else if (m.role === "tool") {
      agent.search = groundingFromMessage(m) ?? agent.search;
      const t =
        agent.tools.find((x) => m.toolCallId && x.id === m.toolCallId) ??
        [...agent.tools].reverse().find((x) => !x.preview);
      if (t) t.preview = m.content.slice(0, 500);
    }
  }
  return turns;
}

/** Replay phase across a restored transcript. */
export function phaseFromTurns(turns: Turn[]): InvestigationPhase {
  let settled: InvestigationPhase = "idle";
  for (const t of turns)
    if (t.role === "agent") settled = settleAfter(t.text, settled);
  return settled;
}
