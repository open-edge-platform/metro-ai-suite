// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";

export interface GeneratedReport {
  id: string;
  title: string;
  preset: string;
  fileName: string;
  createdAt: number;
  size: number;
  blobUrl: string;
  sessionId?: string;
  stops: number;
}

interface ReportsState {
  reports: GeneratedReport[];
  add: (r: GeneratedReport) => void;
  remove: (id: string) => void;
  clear: () => void;
}

/**
 * PDFs generated in this tab. Kept in memory only (decision Q10); blob URLs
 * are revoked on removal and lost on reload.
 */
export const useReportsStore = create<ReportsState>()((set, get) => ({
  reports: [],
  add: (r) => set({ reports: [r, ...get().reports] }),
  remove: (id) => {
    const r = get().reports.find((x) => x.id === id);
    if (r) URL.revokeObjectURL(r.blobUrl);
    set({ reports: get().reports.filter((x) => x.id !== id) });
  },
  clear: () => {
    get().reports.forEach((r) => URL.revokeObjectURL(r.blobUrl));
    set({ reports: [] });
  },
}));
