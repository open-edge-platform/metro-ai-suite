// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { FileText, Radio, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import type { VssHit } from "@/adapters/vss/types";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import { formatClock, hitTime, timeAgo } from "@/lib/time";
import { SpatialMap } from "@/features/map/SpatialMap";
import { cameraName } from "@/stores/cameras";
import { useFloorplanStore } from "@/stores/floorplan";
import { useConfirmedSightings } from "@/stores/hitl";
import {
  buildLiveTrace,
  timelineLines,
  uniqueSegments,
  useTraceStore,
} from "@/stores/trace";
import { useInvestigationStore } from "@/stores/investigation";
import {
  isWatchActive,
  sightingKey,
  useWatchStore,
  type WatchStatus,
} from "@/stores/watch";
import { ClipPlayerDialog } from "./ClipPlayerDialog";
import { MatchCard } from "./MatchCard";

const ENDED: Partial<Record<WatchStatus, string>> = {
  stopped: "Live search stopped by the operator.",
  expired: "Live search ended: the time limit was reached.",
  "idle-stopped": "Live search ended: no new matches for a while.",
  error: "The live search could not start.",
};

/** Live matches shown at once: the closest to the subject. */
const NEAREST = 4;

/**
 * Route of confirmed sightings (historical, then live) with the optional live
 * camera search. After historical verification it offers the live search; once
 * running it shows the 4 nearest live matches, refreshed every 10 seconds.
 */
export function LiveTraceCard() {
  const w = useWatchStore();
  const busy = useInvestigationStore((s) => s.busy);
  const startWatch = useInvestigationStore((s) => s.startWatch);
  const [playing, setPlaying] = useState<VssHit>();
  const [, tick] = useState(0);
  const [replay, setReplay] = useState(0);
  const plan = useFloorplanStore((s) => s.plan);
  const keyMap = useFloorplanStore((s) => s.keyMap);
  const active = isWatchActive(w);
  const seen = useRef(0);

  // Refresh "x ago" labels and announce new sightings.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    const n = w.sightings.length;
    if (n > seen.current && seen.current > 0 && active) {
      const h = w.sightings[0];
      toast.info("New live sighting", {
        description: `${cameraName(h.cameraTag)} at ${formatClock(hitTime(h))}`,
      });
    }
    seen.current = n;
  }, [w.sightings, active]);

  const nearest = useMemo(
    () =>
      w.sightings
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, NEAREST),
    [w.sightings],
  );

  // Unconfirmed live matches are implicit false positives: only confirmed
  // ones join the route.
  // Historical route = every sighting confirmed in any grid this session
  // (plus the seed Argus's watch started from), so later reviews extend it.
  const session = useConfirmedSightings();
  const historical = useMemo(
    () => uniqueSegments([...session, ...w.seed]),
    [session, w.seed],
  );
  const stops = useMemo(
    () =>
      buildLiveTrace(
        historical,
        w.sightings,
        (h) => w.verdicts[sightingKey(h)] !== "confirm",
      ),
    [historical, w.sightings, w.verdicts],
  );

  // Publish the route so the Case File, Floorplan page and reports follow it.
  useEffect(() => {
    if ((!w.status && !w.offered) || !stops.length) return;
    useTraceStore.getState().setLatest({
      turnId: `live:${w.queryId ?? "pending"}`,
      queryId: w.queryId,
      stops,
      createdAt: Date.now(),
    });
  }, [w.status, w.offered, w.queryId, stops]);

  if (!w.status && !w.offered) return null;

  function report() {
    void useInvestigationStore
      .getState()
      .send(
        `Write an incident report for this investigation. The operator confirmed these ${stops.length} sightings (historical and live). They are in time order, with the subject's movement between cameras:\n${timelineLines(stops).join("\n")}`,
      );
  }

  const label = w.subject?.imageUrl
    ? "the subject in the photo"
    : `"${w.subject?.query ?? "the subject"}"`;

  return (
    <section
      aria-label="Confirmed route and live search"
      className="border bg-card"
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        {w.subject?.previewUrl && (
          <img
            src={w.subject.previewUrl}
            alt="Subject"
            className="size-10 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {w.offered ? "Confirmed sightings saved" : "Live camera search"}
            {w.offered ? null : active ? (
              <StatusChip tone="success">
                <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                {w.status === "starting" ? "Starting" : "Searching"}
              </StatusChip>
            ) : (
              <StatusChip tone={w.status === "error" ? "error" : "neutral"}>
                Ended
              </StatusChip>
            )}
          </h3>
          <p className="truncate font-prose text-xs text-muted-foreground">
            {w.offered
              ? `${historical.length} historical sighting${historical.length === 1 ? "" : "s"} on the route. Search the live cameras for ${label}?`
              : active
                ? `Looking for ${label} on the live cameras, refreshing every 10 s. ${
                    w.deadline
                      ? `Stops at ${formatClock(new Date(w.deadline))}.`
                      : ""
                  }`
                : w.status
                  ? (ENDED[w.status] ?? "")
                  : ""}
            {w.error && active ? ` Last check failed: ${w.error}` : ""}
            {!active && w.status === "error" && w.error ? ` ${w.error}` : ""}
          </p>
        </div>
        {w.offered ? (
          <>
            <Button size="sm" onClick={() => void startWatch()} disabled={busy}>
              <Radio /> Start live camera search
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => w.dismiss(w.sessionId ?? "")}
            >
              Not now
            </Button>
          </>
        ) : active ? (
          <Button size="sm" variant="destructive" onClick={() => void w.stop()}>
            <Square /> Stop live search
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={w.clear}>
            Dismiss
          </Button>
        )}
        <Button
          size="sm"
          onClick={report}
          disabled={!stops.length || busy || active}
          title={active ? "Stop the live search first" : undefined}
        >
          <FileText /> Generate report
        </Button>
      </header>
      <div className="relative">
        <SpatialMap
          plan={plan}
          keyMap={keyMap}
          stops={stops}
          replayKey={replay}
          labels="route"
          title="Subject route"
        />
        <div className="absolute top-2 right-2 flex gap-1">
          <Button
            size="xs"
            variant="outline"
            className="bg-background"
            onClick={() => setReplay((r) => r + 1)}
            disabled={!stops.length}
          >
            <RotateCcw /> Replay
          </Button>
          <Button size="xs" variant="outline" className="bg-background" asChild>
            <Link to="/floorplan">Open floorplan</Link>
          </Button>
        </div>
      </div>
      <p className="border-t px-4 pt-3 text-xs text-muted-foreground">
        {stops.length} confirmed stop{stops.length === 1 ? "" : "s"} on the
        route.
        {w.offered
          ? ""
          : " Confirm live matches to add them; unconfirmed ones are ignored."}
      </p>
      {w.offered ? null : nearest.length ? (
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4">
          {nearest.map((h) => {
            const k = sightingKey(h);
            return (
              <MatchCard
                key={k}
                hit={h}
                verdict={w.verdicts[k]}
                minScore={0}
                readOnly={!active && w.verdicts[k] !== "confirm"}
                onVerdict={(v) =>
                  w.setVerdict(k, w.verdicts[k] === v ? undefined : v)
                }
                onPlay={() => setPlaying(h)}
              />
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-6 text-center font-prose text-sm text-muted-foreground">
          {active
            ? `No live matches yet${w.startedAt ? ` (started ${timeAgo(w.startedAt)})` : ""}. The nearest ${NEAREST} appear here.`
            : "No live matches were found."}
        </p>
      )}
      <ClipPlayerDialog
        hit={playing}
        onOpenChange={(o) => !o && setPlaying(undefined)}
        verdict={playing ? w.verdicts[sightingKey(playing)] : undefined}
        onVerdict={
          playing
            ? (v) => {
                const k = sightingKey(playing);
                w.setVerdict(k, w.verdicts[k] === v ? undefined : v);
              }
            : undefined
        }
      />
    </section>
  );
}
