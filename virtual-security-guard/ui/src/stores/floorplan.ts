// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { persist } from "zustand/middleware";
import sample from "@/fixtures/level4.floorplan.json";
import { autoMatchKeys, type KeyMap } from "@/features/map/keymap";
import { floorplanSchema, type Floorplan } from "@/features/map/schema";
import { FIXTURE_TAGS } from "@/fixtures/vss";

export const SAMPLE_FLOORPLAN: Floorplan = floorplanSchema.parse(sample);

interface FloorplanState {
  plan: Floorplan;
  keyMap: KeyMap;
  source: "sample" | "upload";
  fileName?: string;
  setPlan: (
    plan: Floorplan,
    keyMap: KeyMap,
    meta: { source: "sample" | "upload"; fileName?: string },
  ) => void;
  setMapping: (planKey: string, tag: string | undefined) => void;
  setKeyMap: (keyMap: KeyMap) => void;
  reset: () => void;
}

const initial = () => ({
  plan: SAMPLE_FLOORPLAN,
  keyMap: autoMatchKeys(SAMPLE_FLOORPLAN, FIXTURE_TAGS),
  source: "sample" as const,
  fileName: undefined,
});

/** Active facility floorplan and its plan-key -> VSS-tag mapping (persisted). */
export const useFloorplanStore = create<FloorplanState>()(
  persist(
    (set, get) => ({
      ...initial(),
      setPlan: (plan, keyMap, meta) =>
        set({ plan, keyMap, source: meta.source, fileName: meta.fileName }),
      setMapping: (planKey, tag) => {
        const next = { ...get().keyMap };
        for (const [k, t] of Object.entries(next))
          if (tag && t === tag && k !== planKey) delete next[k];
        if (tag) next[planKey] = tag;
        else delete next[planKey];
        set({ keyMap: next });
      },
      setKeyMap: (keyMap) => set({ keyMap }),
      reset: () => set(initial()),
    }),
    {
      name: "vsg.floorplan.v1",
      merge: (persisted, current) => {
        const p = persisted as Partial<FloorplanState> | undefined;
        const ok = p?.plan && floorplanSchema.safeParse(p.plan).success;
        return ok ? { ...current, ...p } : current;
      },
    },
  ),
);
