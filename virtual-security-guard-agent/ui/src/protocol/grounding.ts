// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { HermesMessage } from "@/adapters/hermes/types";
import type { VssHit } from "@/adapters/vss/types";
import { clipPathForVideo, framePath, toDatastorePath } from "@/lib/urls";

/**
 * Tool-result grounding.
 *
 * Argus's directives are supposed to carry a stored VSS query id plus m<rank>
 * refs, but a small local model may garble or invent ids. The hits the UI
 * shows therefore come from the actual `vss_search_video` tool output that
 * Hermes stored in the session transcript; the directive only says *which*
 * of them to highlight. Tool output is untrusted: only typed fields are read,
 * and media URLs are reduced to same-origin datastore paths.
 */

export interface SearchGrounding {
  /** Stored query id when the MCP returned one (see the plan prerequisite). */
  queryId?: string;
  /** Hits in tool-result order; matchId = tool match_id or m<position>. */
  hits: VssHit[];
}

const SEARCH_TOOL_RE = /(?:^|__|\.|\/)vss_search_video$/;
const SOURCE_RE = /<untrusted_tool_result\b[^>]*\bsource="([^"]*)"/;
const MAX_CONTENT = 2_000_000;
const MAX_HITS = 200;

export const isSearchTool = (name: string | undefined) =>
  !!name && SEARCH_TOOL_RE.test(name);

const optNum = z.coerce.number().finite().optional().catch(undefined);
const optStr = (max: number) => z.string().max(max).optional().catch(undefined);

const toolHit = z.object({
  match_id: z
    .string()
    .regex(/^m\d+$/i)
    .transform((s) => s.toLowerCase())
    .optional()
    .catch(undefined),
  video_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
  video_name: optStr(512),
  camera: optStr(128),
  tags: z
    .union([z.array(z.string().max(128)), z.string().max(1024)])
    .optional()
    .catch(undefined),
  start_s: optNum,
  end_s: optNum,
  seek_s: optNum,
  score: optNum,
  url: optStr(2048),
  created_at: optStr(64),
  source: z.enum(["live", "video"]).optional().catch(undefined),
  stream_id: optStr(128),
  observed_at: optStr(64),
  frame: z
    .object({
      video_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
      timestamp: z.coerce.number().finite().nonnegative(),
      media_path: z
        .string()
        .regex(/^[A-Za-z0-9_./-]{1,256}$/)
        .refine((p) => !p.includes(".."))
        .optional()
        .catch(undefined),
      bucket_name: z
        .string()
        .regex(/^[A-Za-z0-9_.-]{1,64}$/)
        .optional()
        .catch(undefined),
      crop_bbox: z
        .string()
        .regex(/^-?\d+(?:,-?\d+){3}$/)
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

type Json = Record<string, unknown>;

/**
 * Extract the first balanced `{...}` or `[...]` from the start of `s`,
 * tolerating trailing prose after it (MCP tools often append human-readable
 * "resource link" lines after the JSON). Bracket counting respects quoted
 * strings and escapes so braces inside values don't throw it off.
 */
function extractLeadingJson(s: string): string | undefined {
  const open = s[0];
  if (open !== "{" && open !== "[") return undefined;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(0, i + 1);
  }
  return undefined;
}

/** Strip the Hermes `<untrusted_tool_result>` wrapper and parse the JSON body. */
export function parseToolJson(content: string): unknown {
  if (!content || content.length > MAX_CONTENT) return undefined;
  const body = content.replace(/<\/?untrusted_tool_result\b[^>]*>/g, "").trim();
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trimStart();
    if (!head.startsWith("{") && !head.startsWith("[")) continue;
    const rest = lines.slice(i).join("\n").trim();
    try {
      return JSON.parse(rest);
    } catch {
      const leading = extractLeadingJson(rest);
      try {
        if (leading) return JSON.parse(leading);
      } catch {
        // not JSON from here, keep scanning
      }
    }
  }
  return undefined;
}

/**
 * Find the search payload ({results:[…]}) inside MCP envelopes:
 * `{"result":"<json>"}`, `{"content":[{"type":"text","text":"<json>"}]}`,
 * `structuredContent`, or the bare object.
 */
const isSearchPayload = (o: Json) =>
  Array.isArray(o.results) || Array.isArray(o.hits);
const isWatchPayload = (o: Json) =>
  Array.isArray(o.sightings) && typeof o.query_id === "string";

function findPayload(
  v: unknown,
  depth = 0,
  match: (o: Json) => boolean = isSearchPayload,
): Json | undefined {
  if (depth > 5 || v == null) return undefined;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s.startsWith("{") && !s.startsWith("[")) return undefined;
    try {
      return findPayload(JSON.parse(s), depth + 1, match);
    } catch {
      // MCP tools often append human-readable text (e.g. "resource link"
      // lines) after the JSON payload; retry on just the balanced prefix.
      const leading = extractLeadingJson(s);
      if (!leading) return undefined;
      try {
        return findPayload(JSON.parse(leading), depth + 1, match);
      } catch {
        return undefined;
      }
    }
  }
  if (Array.isArray(v)) {
    for (const c of v) {
      const text = (c as Json | null)?.text;
      const r = findPayload(
        typeof text === "string" ? text : c,
        depth + 1,
        match,
      );
      if (r) return r;
    }
    return undefined;
  }
  if (typeof v !== "object") return undefined;
  const o = v as Json;
  if (match(o)) return o;
  for (const k of ["structuredContent", "result", "content", "data"]) {
    const r = findPayload(o[k], depth + 1, match);
    if (r) return r;
  }
  return undefined;
}

function firstTag(v: string | string[] | undefined): string | undefined {
  const t = Array.isArray(v) ? v[0] : v?.split(",")[0];
  return t?.trim() || undefined;
}

function hitsFromRows(rows: unknown[]): VssHit[] {
  const hits: VssHit[] = [];
  rows.forEach((row) => {
    const r = toolHit.safeParse(row);
    if (!r.success) return;
    const d = r.data;
    const position = hits.length + 1;
    const rank = d.match_id
      ? Number(d.match_id.slice(1)) || position
      : position;
    const start = d.start_s ?? d.seek_s ?? 0;
    const live = d.source === "live";
    const frame = d.frame && {
      videoId: d.frame.video_id,
      timestamp: d.frame.timestamp,
      mediaPath: d.frame.media_path,
      bucketName: d.frame.bucket_name,
      cropBbox: d.frame.crop_bbox,
    };
    const observed =
      d.observed_at && !Number.isNaN(Date.parse(d.observed_at))
        ? d.observed_at
        : undefined;
    hits.push({
      matchId: d.match_id ?? `m${position}`,
      rank,
      videoId: d.video_id,
      videoName: d.video_name,
      cameraTag:
        d.camera ??
        firstTag(d.tags) ??
        (live ? (d.stream_id ?? d.video_id) : undefined),
      startS: start,
      endS: d.end_s ?? start,
      seekS: d.seek_s ?? start,
      score: d.score ?? 0,
      ingestedAt: d.created_at,
      playbackUrl:
        toDatastorePath(d.url) ??
        (live ? undefined : clipPathForVideo(d.video_id)),
      ...(live && {
        source: "live" as const,
        streamId: d.stream_id ?? d.video_id,
      }),
      ...(observed && { observedAt: observed }),
      ...(frame && { frame, posterUrl: framePath(frame) }),
    });
  });
  return hits;
}

/** Parse a vss_search_video result into hits. Undefined if it isn't one. */
export function parseSearchResult(
  content: string,
): SearchGrounding | undefined {
  const payload = findPayload(parseToolJson(content));
  if (!payload) return undefined;
  const rows = (
    (Array.isArray(payload.results)
      ? payload.results
      : payload.hits) as unknown[]
  ).slice(0, MAX_HITS);
  const hits = hitsFromRows(rows);
  if (rows.length && !hits.length) return undefined;
  const qid = payload.query_id ?? payload.queryId;
  return {
    queryId:
      typeof qid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(qid)
        ? qid
        : undefined,
    hits,
  };
}

/**
 * Grounding from one transcript message. Search results are recognised by
 * tool name, the wrapper's `source`, or (for meta-tools such as `tool_call`)
 * by payload shape when it actually contains hits.
 */
export function groundingFromMessage(
  m: Pick<HermesMessage, "role" | "content" | "toolName">,
): SearchGrounding | undefined {
  if (m.role !== "tool") return undefined;
  const named =
    isSearchTool(m.toolName) ||
    isSearchTool(SOURCE_RE.exec(m.content.slice(0, 512))?.[1]);
  const g = parseSearchResult(m.content);
  if (!g) return undefined;
  return named || g.hits.length ? g : undefined;
}

/**
 * Latest search grounding of the most recent run: tool messages after the
 * last user message.
 */
export function groundingFromLatestRun(
  messages: readonly HermesMessage[],
): SearchGrounding | undefined {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      start = i + 1;
      break;
    }
  let found: SearchGrounding | undefined;
  for (let i = start; i < messages.length; i++)
    found = groundingFromMessage(messages[i]) ?? found;
  return found;
}

const QID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A vss_watch_search result: the watched query and its new live sightings. */
export interface WatchGrounding {
  queryId: string;
  watch: boolean;
  expired: boolean;
  sightings: VssHit[];
  expiresAt?: string;
  pollAfterS?: number;
}

/** Parse a vss_watch_search result. Undefined if it isn't one. */
export function parseWatchResult(content: string): WatchGrounding | undefined {
  const p = findPayload(parseToolJson(content), 0, isWatchPayload);
  if (!p || !QID_RE.test(p.query_id as string)) return undefined;
  const poll = Number(p.poll_after_seconds);
  return {
    queryId: p.query_id as string,
    watch: p.watch === true,
    expired: p.expired === true,
    sightings: hitsFromRows((p.sightings as unknown[]).slice(0, MAX_HITS)),
    expiresAt:
      typeof p.expires_at === "string" &&
      !Number.isNaN(Date.parse(p.expires_at))
        ? p.expires_at
        : undefined,
    pollAfterS: Number.isFinite(poll) && poll > 0 ? poll : undefined,
  };
}

/** Latest vss_watch_search result of the most recent run. */
export function watchFromLatestRun(
  messages: readonly HermesMessage[],
): WatchGrounding | undefined {
  let found: WatchGrounding | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    if (m.role !== "tool") continue;
    found = parseWatchResult(m.content);
    if (found) break;
  }
  return found;
}
