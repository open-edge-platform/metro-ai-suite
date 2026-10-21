// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { hitCameraLabel } from "@/lib/hits";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TraceStop } from "@/stores/case";

interface Props {
  stops: TraceStop[];
  /** Show at most this many stops, then "and N more". */
  max?: number;
  size?: "sm" | "md";
}

/** Numbered route stops: order, time and camera. */
export function RouteStopList({ stops, max, size = "md" }: Props) {
  const shown = max ? stops.slice(0, max) : stops;
  const sm = size === "sm";
  return (
    <ol className={cn("grid", sm ? "gap-1 text-xs" : "gap-1.5 text-sm")}>
      {shown.map((s) => (
        <li key={s.order + s.hit.matchId} className="flex items-center gap-2">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-track font-bold text-white",
              sm ? "size-4 text-[0.625rem]" : "size-5 text-[0.6875rem]",
            )}
          >
            {s.order}
          </span>
          <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatClock(s.at)}
          </span>
          <span className="truncate font-mono">{hitCameraLabel(s.hit)}</span>
        </li>
      ))}
      {stops.length > shown.length && (
        <li className="text-muted-foreground">
          and {stops.length - shown.length} more
        </li>
      )}
    </ol>
  );
}
