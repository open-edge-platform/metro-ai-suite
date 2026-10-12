// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { PROTOCOL_VERSION } from "./directives";

function block(fence: string, payload: Record<string, unknown>): string {
  const clean = Object.fromEntries(
    Object.entries(payload).filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0),
    ),
  );
  return [
    "```" + fence,
    JSON.stringify({ v: PROTOCOL_VERSION, ...clean }),
    "```",
  ].join("\n");
}

export interface SearchRequest {
  text: string;
  imageUrl?: string;
  tags?: string[];
  start?: string;
  end?: string;
  limit?: number;
}

/** Operator prompt + optional vsg-context block, sent as the Hermes run input. */
export function buildSearchInput(req: SearchRequest): string {
  const prose =
    req.text.trim() ||
    (req.imageUrl ? "Find this person in the recorded footage." : "");
  const hasContext =
    req.imageUrl || req.tags?.length || req.start || req.end || req.limit;
  if (!hasContext) return prose;
  return [
    prose,
    "",
    block("vsg-context", {
      image_url: req.imageUrl,
      tags: req.tags,
      start: req.start,
      end: req.end,
      limit: req.limit,
    }),
  ].join("\n");
}

export interface ReviewFeedback {
  queryId?: string;
  confirm: string[];
  reject: string[];
  anchorImageUrl?: string;
  text?: string;
  /** ref -> short clip label (camera, clip, offset) for the prose summary. */
  labels?: Record<string, string>;
}

/** Human-readable summary first (helps the model), then the machine block. */
export function serializeFeedback(fb: ReviewFeedback): string {
  const name = (r: string) => (fb.labels?.[r] ? `${r} (${fb.labels[r]})` : r);
  const parts: string[] = [];
  if (fb.confirm.length)
    parts.push(
      `Confirmed ${fb.confirm.map(name).join(", ")}. Trace this person across the other cameras.`,
    );
  else parts.push("None of these are the right person. Refine the search.");
  if (fb.reject.length)
    parts.push(
      `Rejected as false positives: ${fb.reject.map(name).join(", ")}.`,
    );
  if (fb.text?.trim()) parts.push(fb.text.trim());
  return [
    parts.join(" "),
    "",
    block("vsg-feedback", {
      vss_query_id: fb.queryId,
      confirm: fb.confirm,
      reject: fb.reject,
      anchor_image_url: fb.anchorImageUrl,
      text: fb.text?.trim(),
    }),
  ].join("\n");
}
