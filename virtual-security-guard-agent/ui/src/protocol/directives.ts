// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/**
 * VSG directive protocol v1.
 *
 * Argus (the Hermes agent) embeds small fenced JSON blocks in its replies:
 *
 *   ```vsg-matches
 *   {"v":1,"vss_query_id":"…","keep":["m1","m3"],"note":"…"}
 *   ```
 *
 * Directives carry references only (m<rank> refs, optionally a stored VSS query
 * id); the UI resolves the hits from VSS or from the vss_search_video result in
 * the session transcript (see grounding.ts). Keep this file in sync with
 * hermes-skills/virtual-security-guard/references/directive-protocol.md.
 */
export const PROTOCOL_VERSION = 1;

/** Accept 1 or "1"; anything else is a version we do not understand. */
const version = z
  .union([z.literal(1), z.literal("1")])
  .optional()
  .transform(() => 1 as const);

/** m<rank> where rank is the 1-based position in GET /manager/search/:id results. */
export const matchRef = z
  .string()
  .trim()
  .regex(/^m\d+$/i, "expected a match ref like m3")
  .transform((s) => s.toLowerCase());
export type MatchRef = z.infer<typeof matchRef>;

/**
 * Agent-supplied ref: m<rank> preferred, but a video id or `<video_id>@<start_s>`
 * is tolerated (small models copy ids from the tool output). Resolved against
 * the hits with lib/hits.ts#resolveRefs; unresolvable refs are ignored.
 */
export const looseRef = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((s) => (/^m\d+$/i.test(s) ? s.toLowerCase() : s));

const refList = z
  .array(z.union([looseRef, z.number().int().positive()]))
  .optional()
  .default([])
  .transform((xs) => xs.map((x) => (typeof x === "number" ? `m${x}` : x)));

/** Legacy fallback: hits copied inline by the agent (least trusted source). */
export const inlineMatch = z.object({
  match_id: matchRef.optional().catch(undefined),
  video_id: z.string().min(1).max(128),
  video_name: z.string().optional(),
  camera: z.string().optional(),
  start_s: z.coerce.number().optional(),
  end_s: z.coerce.number().optional(),
  seek_s: z.coerce.number().optional(),
  score: z.coerce.number().optional(),
  url: z.string().optional(),
});
export type InlineMatch = z.infer<typeof inlineMatch>;

export const phaseSchema = z.enum([
  "search",
  "validate",
  "trace",
  "report",
  "idle",
]);
export type DirectivePhase = z.infer<typeof phaseSchema>;

export const statusDirective = z.object({
  v: version,
  phase: phaseSchema,
  message: z.string().optional(),
});

/** Hint only: the UI verifies it and otherwise uses the transcript's tool result. */
const queryIdHint = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .optional()
  .catch(undefined);

/** Inline matches are a fallback; drop malformed entries instead of the block. */
const inlineList = z
  .array(z.unknown())
  .optional()
  .transform((xs) =>
    xs
      ?.map((x) => inlineMatch.safeParse(x))
      .filter((r) => r.success)
      .map((r) => r.data),
  );

/**
 * `{"v":1,"keep":["m1"],"note":"…"}` is enough: hits come from the latest
 * vss_search_video result (or `vss_query_id` when it resolves).
 */
export const matchesDirective = z.object({
  v: version,
  vss_query_id: queryIdHint,
  keep: refList,
  note: z.string().optional(),
  notes: z.record(z.string(), z.string()).optional().default({}),
  matches: inlineList,
});

export const trackAnchor = z.union([
  looseRef,
  z.object({ video_id: z.string().min(1).max(128), seek_s: z.coerce.number() }),
]);

export const trackDirective = z.object({
  v: version,
  vss_query_id: queryIdHint,
  anchor: trackAnchor.optional().catch(undefined),
  keep: refList,
  note: z.string().optional(),
  matches: inlineList,
});

export const reportPreset = z.enum(["handover", "escalation", "brief"]);
export const confidence = z.enum(["low", "medium", "high"]);

export const reportDirective = z.object({
  v: version,
  title: z.string().min(1).max(160),
  preset: reportPreset.catch("handover").default("handover"),
  summary: z.string().default(""),
  subject: z.string().default(""),
  timeline: z
    .array(
      z.object({
        ref: z.string().optional(),
        note: z.string().default(""),
      }),
    )
    .default([]),
  observations: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  confidence: confidence.catch("medium").default("medium"),
  vss_query_id: z.string().optional(),
});

/** UI -> agent: operator review verdicts. */
export const feedbackDirective = z.object({
  v: version,
  vss_query_id: z.string().optional(),
  confirm: z.array(matchRef).default([]),
  reject: z.array(matchRef).default([]),
  /** Legacy operator note; the UI no longer sends it. */
  text: z.string().optional(),
});

/** UI -> agent: structured search context attached to an operator prompt. */
export const contextDirective = z.object({
  v: version,
  image_url: z.string().optional(),
  tags: z.array(z.string()).optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type StatusDirective = z.infer<typeof statusDirective>;
export type MatchesDirective = z.infer<typeof matchesDirective>;
export type TrackDirective = z.infer<typeof trackDirective>;
export type ReportDirective = z.infer<typeof reportDirective>;
export type FeedbackDirective = z.infer<typeof feedbackDirective>;
export type ContextDirective = z.infer<typeof contextDirective>;

export type Directive =
  | { type: "status"; data: StatusDirective }
  | { type: "matches"; data: MatchesDirective }
  | { type: "track"; data: TrackDirective }
  | { type: "report"; data: ReportDirective }
  | { type: "feedback"; data: FeedbackDirective }
  | { type: "context"; data: ContextDirective };

export type DirectiveType = Directive["type"];

/** Fence info-string -> schema. `vsg-tick` is reserved for live tracking and ignored. */
export const DIRECTIVE_SCHEMAS = {
  "vsg-status": { type: "status", schema: statusDirective },
  "vsg-matches": { type: "matches", schema: matchesDirective },
  "vsg-track": { type: "track", schema: trackDirective },
  "vsg-report": { type: "report", schema: reportDirective },
  "vsg-feedback": { type: "feedback", schema: feedbackDirective },
  "vsg-context": { type: "context", schema: contextDirective },
} as const;

export type DirectiveFence = keyof typeof DIRECTIVE_SCHEMAS;

export function isKnownFence(name: string): name is DirectiveFence {
  return Object.prototype.hasOwnProperty.call(DIRECTIVE_SCHEMAS, name);
}
