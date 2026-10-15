// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SettingsState {
  sidebarOpen: boolean;
  caseFileOpen: boolean;
  /** Minimum VSS relevance score for a sighting to join the trace. */
  minTraceScore: number;
  /** Upper bound on hits Argus is asked to return per search. */
  searchLimit: number;
  /** Live watch stops after this many minutes. */
  watchMinutes: number;
  /** Live watch stops after this many minutes without a new sighting. */
  watchIdleMinutes: number;
  setSidebarOpen: (open: boolean) => void;
  setCaseFileOpen: (open: boolean) => void;
  setMinTraceScore: (v: number) => void;
  setSearchLimit: (v: number) => void;
  setWatchMinutes: (v: number) => void;
  setWatchIdleMinutes: (v: number) => void;
  reset: () => void;
}

export const SETTINGS_DEFAULTS = {
  sidebarOpen: true,
  caseFileOpen: true,
  minTraceScore: 0.6,
  searchLimit: 24,
  watchMinutes: 30,
  watchIdleMinutes: 10,
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setCaseFileOpen: (caseFileOpen) => set({ caseFileOpen }),
      setMinTraceScore: (v) => set({ minTraceScore: clamp(v, 0, 1) }),
      setSearchLimit: (v) => set({ searchLimit: Math.round(clamp(v, 4, 50)) }),
      setWatchMinutes: (v) =>
        set({ watchMinutes: Math.round(clamp(v, 1, 240)) }),
      setWatchIdleMinutes: (v) =>
        set({ watchIdleMinutes: Math.round(clamp(v, 1, 120)) }),
      reset: () => set(SETTINGS_DEFAULTS),
    }),
    { name: "vsg.settings.v1" },
  ),
);
