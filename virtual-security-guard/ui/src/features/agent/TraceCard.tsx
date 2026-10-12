// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Loader2, RotateCcw, RotateCw } from "lucide-react";
import type { VssHit } from "@/adapters/vss/types";
import { HitThumb, StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpatialMap } from "@/features/map/SpatialMap";
import { layoutRoute } from "@/features/map/route";
import { formatClock } from "@/lib/time";
import type { TrackDirective } from "@/protocol/directives";
import { useFloorplanStore } from "@/stores/floorplan";
import { useSettingsStore } from "@/stores/settings";
import { buildTrace, routeCameras, useTraceStore } from "@/stores/trace";
import { useWatchStore } from "@/stores/watch";
import { ClipPlayerDialog } from "./ClipPlayerDialog";
import { useDirectiveHits } from "./useDirectiveHits";
import { useRejectedSegments } from "./useRejectedSegments";
import { cameraName } from "@/stores/cameras";

interface Props {
  data: TrackDirective;
  turnId: string;
  /** The newest trace in the conversation publishes itself to the Case File. */
  latest: boolean;
}

/** Route reconstruction after a confirmed sighting: blueprint map plus timeline. */
export function TraceCard({ data, turnId, latest }: Props) {
  const { hits, queryId, isLoading, isRunning, error, refetch } =
    useDirectiveHits(data, turnId);
  const minScore = useSettingsStore((s) => s.minTraceScore);
  const rejected = useRejectedSegments();
  const plan = useFloorplanStore((s) => s.plan);
  const keyMap = useFloorplanStore((s) => s.keyMap);
  const setLatest = useTraceStore((s) => s.setLatest);
  const [replay, setReplay] = useState(0);
  const [playing, setPlaying] = useState<VssHit>();

  const stops = useMemo(
    () => buildTrace(hits, { keep: data.keep, minScore, rejected }),
    [hits, data.keep, minScore, rejected],
  );
  const offMap = useMemo(
    () => layoutRoute(stops, plan, keyMap).offMap,
    [stops, plan, keyMap],
  );
  const cameras = routeCameras(stops);
  const anchor = typeof data.anchor === "string" ? data.anchor : undefined;

  useEffect(() => {
    if (!latest || isLoading) return;
    // A running or finished live trace owns the published route.
    const live = useWatchStore.getState();
    if (live.status || live.offered) return;
    setLatest({ turnId, queryId, anchor, stops, createdAt: Date.now() });
  }, [latest, isLoading, turnId, queryId, anchor, stops, setLatest]);

  if (isLoading || isRunning)
    return (
      <section className="border bg-card p-3" aria-busy>
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Building the route from
          VSS sightings
        </p>
        <Skeleton className="aspect-[1000/620] rounded-none" />
      </section>
    );

  if (error)
    return (
      <section className="status-error flex items-center gap-3 border border-[var(--status-border)] bg-[var(--status-bg)] p-3 text-sm text-[var(--status-fg)]">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">
          Couldn't load trace {queryId}: {error.message}
        </span>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RotateCw /> Retry
        </Button>
      </section>
    );

  return (
    <section className="border bg-card" aria-label="Route trace">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Route trace</h3>
          <p className="text-xs text-muted-foreground">
            {stops.length
              ? `${stops.length} sighting${stops.length === 1 ? "" : "s"} across ${new Set(cameras).size} camera${new Set(cameras).size === 1 ? "" : "s"}, ordered by recording time`
              : "No sightings passed the relevance threshold"}
            {anchor ? `. Anchored on ${anchor}.` : "."}
          </p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setReplay((r) => r + 1)}
          disabled={!stops.length}
        >
          <RotateCcw /> Replay
        </Button>
        <Button size="xs" variant="ghost" asChild>
          <Link to="/floorplan">Open floorplan</Link>
        </Button>
      </header>

      <SpatialMap
        plan={plan}
        keyMap={keyMap}
        stops={stops}
        replayKey={replay}
        labels="route"
        title="Subject route"
      />

      {stops.length > 0 ? (
        <ol
          className="flex gap-2 overflow-x-auto border-t p-2.5"
          aria-label="Sightings timeline"
        >
          {stops.map((s) => {
            const name = s.hit.cameraTag
              ? cameraName(s.hit.cameraTag)
              : "Unknown camera";
            return (
              <li
                key={`${s.hit.videoId}-${s.hit.startS}`}
                className="w-36 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => setPlaying(s.hit)}
                  className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <HitThumb hit={s.hit} alt={`Sighting ${s.order} on ${name}`}>
                    <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-track text-[0.6875rem] font-bold text-white">
                      {s.order}
                    </span>
                  </HitThumb>
                  <span className="mt-1 block truncate text-xs font-medium">
                    {name}
                  </span>
                  <span className="block font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
                    {formatClock(s.at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="border-t p-3 font-prose text-sm text-muted-foreground">
          Nothing scored at least {Math.round(minScore * 100)}% relevance. Lower
          the threshold in{" "}
          <Link to="/settings" className="underline underline-offset-2">
            Settings
          </Link>{" "}
          or confirm a clearer sighting.
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        {offMap.length > 0 && (
          <StatusChip tone="pending">
            <AlertTriangle />
            {offMap.length} sighting{offMap.length === 1 ? " is" : "s are"} on
            cameras missing from the floorplan
          </StatusChip>
        )}
      </footer>

      <ClipPlayerDialog
        hit={playing}
        onOpenChange={(o) => !o && setPlaying(undefined)}
      />
    </section>
  );
}
