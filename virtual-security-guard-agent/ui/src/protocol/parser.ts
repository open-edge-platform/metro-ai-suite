// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  DIRECTIVE_SCHEMAS,
  isKnownFence,
  type Directive,
  type DirectiveType,
} from "./directives";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "directive"; directive: Directive; raw: string }
  | { kind: "invalid"; fence: string; raw: string; error: string }
  | { kind: "pending"; fence: string };

const FENCE_RE = /```[ \t]*(vsg-[a-z-]+)[^\n]*\n([\s\S]*?)```/g;
const OPEN_FENCE_RE = /```[ \t]*(vsg-[a-z-]*)[^\n]*(\n[\s\S]*)?$/;

/**
 * JSON.parse with the repairs small models most often need: smart quotes,
 * trailing commas, // comment lines and prose around the object.
 */
export function lenientJson(raw: string): unknown {
  const s = raw.trim();
  try {
    return JSON.parse(s);
  } catch {
    // fall through to repairs
  }
  let fixed = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  const a = fixed.indexOf("{");
  const b = fixed.lastIndexOf("}");
  if (a >= 0 && b > a) fixed = fixed.slice(a, b + 1);
  return JSON.parse(fixed);
}

function parseBlock(fence: string, body: string): Segment {
  if (!isKnownFence(fence)) return { kind: "text", text: "" };
  const { type, schema } = DIRECTIVE_SCHEMAS[fence];
  let json: unknown;
  try {
    json = lenientJson(body);
  } catch (e) {
    return {
      kind: "invalid",
      fence,
      raw: body,
      error: `Not valid JSON: ${(e as Error).message}`,
    };
  }
  const res = schema.safeParse(json);
  if (!res.success) {
    return {
      kind: "invalid",
      fence,
      raw: body,
      error: res.error.issues
        .map((i) => `${i.path.join(".") || fence}: ${i.message}`)
        .join("; "),
    };
  }
  return {
    kind: "directive",
    directive: { type, data: res.data } as Directive,
    raw: body,
  };
}

/** Remove model reasoning that leaked into content. */
function stripThinking(text: string, streaming: boolean): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  if (streaming) t = t.replace(/<think>[\s\S]*$/, "");
  return t;
}

function pushText(out: Segment[], text: string) {
  const t = text.replace(/^\s*\n|\n\s*$/g, "");
  if (t.trim()) out.push({ kind: "text", text: t });
}

/**
 * Split agent content into prose and directive segments.
 * - Known vsg-* fences are validated; failures become "invalid" segments (rendered
 *   as a "couldn't render" chip with the raw block).
 * - Unknown vsg-* fences (e.g. reserved vsg-tick) are dropped.
 * - While streaming, an unterminated vsg-* fence becomes a "pending" segment so raw
 *   JSON never flashes on screen.
 */
export function parseAgentText(
  text: string,
  opts: { streaming?: boolean } = {},
): Segment[] {
  const streaming = !!opts.streaming;
  const src = stripThinking(text ?? "", streaming);
  const out: Segment[] = [];
  let last = 0;
  for (const m of src.matchAll(FENCE_RE)) {
    const idx = m.index ?? 0;
    pushText(out, src.slice(last, idx));
    const seg = parseBlock(m[1], m[2]);
    if (seg.kind !== "text") out.push(seg);
    last = idx + m[0].length;
  }
  let rest = src.slice(last);
  const open = OPEN_FENCE_RE.exec(rest);
  if (open) {
    pushText(out, rest.slice(0, open.index));
    const fence = open[1] || "vsg-";
    if (streaming) out.push({ kind: "pending", fence });
    else if (isKnownFence(fence))
      out.push({
        kind: "invalid",
        fence,
        raw: (open[2] ?? "").trim(),
        error: "Block was not closed",
      });
    return out;
  }
  if (streaming) rest = rest.replace(/`{1,3}[a-z-]*$/, "");
  pushText(out, rest);
  return out;
}

export function extractDirectives(text: string): Directive[] {
  return parseAgentText(text)
    .filter(
      (s): s is Extract<Segment, { kind: "directive" }> =>
        s.kind === "directive",
    )
    .map((s) => s.directive);
}

export function lastDirective<T extends DirectiveType>(
  text: string,
  type: T,
): Extract<Directive, { type: T }> | undefined {
  const all = extractDirectives(text).filter((d) => d.type === type);
  return all[all.length - 1] as Extract<Directive, { type: T }> | undefined;
}

/** Prose only, with every vsg-* block removed (used for operator turns). */
export function stripDirectives(text: string): string {
  return parseAgentText(text)
    .filter((s) => s.kind === "text")
    .map((s) => (s as { text: string }).text)
    .join("\n\n")
    .trim();
}
