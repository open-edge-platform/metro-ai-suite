// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { Floorplan } from "./schema";

/** Plan camera key -> VSS camera tag. */
export type KeyMap = Record<string, string>;

/**
 * Mapping the plan itself declares: a camera whose `camera_id`, else whose
 * key, is exactly a known VSS tag. Nothing is guessed from similar names;
 * every other camera is mapped by the operator.
 */
export function declaredKeyMap(plan: Floorplan, tags: string[]): KeyMap {
  const tagSet = new Set(tags);
  const out: KeyMap = {};
  for (const [k, cam] of Object.entries(plan.cameras)) {
    const tag = cam.camera_id ?? k;
    if (tagSet.has(tag)) out[k] = tag;
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
