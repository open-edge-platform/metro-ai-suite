// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { Floorplan } from "./schema";

/** Plan camera key -> VSS camera tag. */
export type KeyMap = Record<string, string>;

/** "P_Lev_4_Main_Entry_ip_54" and "main-entry" both normalise to "mainentry". */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^p_lev_\d+_/, "")
    .replace(/_ip_\d+$/, "")
    .replace(/(cam(era)?|vss)[_-]?\d*$/, "")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/^p_lev_\d+_/, "")
      .replace(/_ip_\d+$/, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !/^(cam|camera|vss|\d+)$/.test(t)),
  );
}

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => tb.has(t) && inter++);
  return inter / (ta.size + tb.size - inter);
}

/**
 * Best-effort mapping of plan keys to VSS tags:
 * camera_id > exact key > normalised key > unambiguous token similarity (>= 0.5).
 * Each tag is used at most once.
 */
export function autoMatchKeys(plan: Floorplan, tags: string[]): KeyMap {
  const out: KeyMap = {};
  const used = new Set<string>();
  const tagSet = new Set(tags);
  const keys = Object.keys(plan.cameras);
  const take = (k: string, t: string) => {
    out[k] = t;
    used.add(t);
  };

  for (const k of keys) {
    const id = plan.cameras[k].camera_id;
    if (id && tagSet.has(id) && !used.has(id)) take(k, id);
    else if (tagSet.has(k) && !used.has(k)) take(k, k);
  }
  for (const k of keys) {
    if (out[k]) continue;
    const nk = normalizeKey(plan.cameras[k].camera_id ?? k);
    const hit = tags.find((t) => !used.has(t) && normalizeKey(t) === nk);
    if (hit) take(k, hit);
  }
  for (const k of keys) {
    if (out[k]) continue;
    const ranked = tags
      .filter((t) => !used.has(t))
      .map((t) => ({ t, s: similarity(k, t) }))
      .sort((a, b) => b.s - a.s);
    const [best, second] = ranked;
    if (best && best.s >= 0.5 && (!second || best.s > second.s))
      take(k, best.t);
  }
  return out;
}

export function unmappedKeys(plan: Floorplan, map: KeyMap): string[] {
  return Object.keys(plan.cameras).filter((k) => !map[k]);
}

/** Tag -> plan key. */
export function invertKeyMap(map: KeyMap): Map<string, string> {
  const inv = new Map<string, string>();
  for (const [k, t] of Object.entries(map)) if (t) inv.set(t, k);
  return inv;
}
