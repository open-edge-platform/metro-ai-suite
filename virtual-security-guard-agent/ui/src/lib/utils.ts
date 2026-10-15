// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable short id for client-side records (turns, reports). */
export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Turn a VSS camera tag into a readable place name: P_Lev_4_Main_Entry_ip_54 -> "Main Entry". */
export function cameraLabel(tag: string): string {
  const core = tag
    .replace(/^P_Lev_\d+_/i, "")
    .replace(/_ip_\d+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!core) return tag;
  return core.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Extract an IP suffix encoded in a VSS camera tag (…_ip_54) if present. */
export function cameraIpHint(tag: string): string | undefined {
  const m = /_ip_(\d{1,3})$/i.exec(tag);
  return m ? `x.x.x.${m[1]}` : undefined;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
