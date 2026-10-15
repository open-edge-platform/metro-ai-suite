// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { Link } from "react-router";
import {
  CheckCircle2,
  Download,
  FileText,
  Map as MapIcon,
  UserSearch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadReport } from "@/features/reports/useReportGenerator";
import { SpatialMap } from "@/features/map/SpatialMap";
import { formatClock, timeAgo } from "@/lib/time";
import { useFloorplanStore } from "@/stores/floorplan";
import { useConfirmedSightings, useHitlStore } from "@/stores/hitl";
import {
  useInvestigationStore,
  type OperatorTurn,
} from "@/stores/investigation";
import { useReportsStore } from "@/stores/reports";
import { useTraceStore } from "@/stores/trace";
import { PhaseStepper } from "./PhaseStepper";
import { cameraName } from "@/stores/cameras";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Right-hand summary of the open investigation. */
export function CaseFilePanel() {
  const turns = useInvestigationStore((s) => s.turns);
  const phase = useInvestigationStore((s) => s.phase);
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const subjectImage = useInvestigationStore((s) => s.subjectImage);
  const verdicts = useHitlStore((s) => s.verdicts);
  const trace = useTraceStore((s) => s.latest);
  const plan = useFloorplanStore((s) => s.plan);
  const keyMap = useFloorplanStore((s) => s.keyMap);
  const allReports = useReportsStore((s) => s.reports);
  const reports = useMemo(
    () =>
      sessionId ? allReports.filter((r) => r.sessionId === sessionId) : [],
    [allReports, sessionId],
  );

  const brief = turns.find(
    (t): t is OperatorTurn => t.role === "operator" && t.kind === "search",
  )?.text;
  const session = useConfirmedSightings();
  const counts = useMemo(() => {
    let reject = 0;
    for (const q of Object.values(verdicts))
      for (const v of Object.values(q)) if (v === "reject") reject++;
    // Confirmed = unique sightings across every grid of the session.
    return { confirm: session.length, reject };
  }, [verdicts, session]);
  const hasReport = reports.length > 0 || phase === "reporting";

  return (
    <aside
      className="hidden w-80 shrink-0 flex-col overflow-auto border-l bg-sidebar lg:flex"
      aria-label="Case file"
    >
      <div className="flex h-11 items-center gap-2 border-b px-4">
        <UserSearch className="size-4 text-brand-accent" />
        <h2 className="text-sm font-semibold">Case file</h2>
      </div>

      <Section title="Subject">
        {subjectImage || brief ? (
          <div className="flex gap-3">
            {subjectImage && (
              <img
                src={subjectImage.previewUrl}
                alt="Subject reference"
                className="size-16 shrink-0 border object-cover"
              />
            )}
            <p className="line-clamp-4 font-prose text-sm">
              {brief ?? "Image search"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Start a search to open a case.
          </p>
        )}
      </Section>

      <Section title="Progress">
        <PhaseStepper
          phase={phase}
          started={turns.length > 0}
          hasReport={hasReport}
          orientation="vertical"
        />
      </Section>

      <Section title="Review">
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="size-2 bg-confirm" />
            {counts.confirm} confirmed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 bg-reject" />
            {counts.reject} false positive{counts.reject === 1 ? "" : "s"}
          </span>
        </div>
      </Section>

      <Section title="Route">
        {trace?.stops.length ? (
          <div className="grid gap-2">
            <Link
              to="/floorplan"
              className="block border"
              aria-label="Open the floorplan"
            >
              <SpatialMap
                plan={plan}
                keyMap={keyMap}
                stops={trace.stops}
                animate={false}
                labels="none"
              />
            </Link>
            <ol className="grid gap-1 text-xs">
              {trace.stops.slice(0, 8).map((s) => (
                <li
                  key={s.order + s.hit.matchId}
                  className="flex items-center gap-2"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-track text-[0.625rem] font-bold text-white">
                    {s.order}
                  </span>
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                    {formatClock(s.at)}
                  </span>
                  <span className="truncate">
                    {s.hit.cameraTag
                      ? cameraName(s.hit.cameraTag)
                      : s.hit.videoName}
                  </span>
                </li>
              ))}
              {trace.stops.length > 8 && (
                <li className="text-muted-foreground">
                  and {trace.stops.length - 8} more
                </li>
              )}
            </ol>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapIcon className="size-4" />
            Confirm a sighting to trace the route.
          </p>
        )}
      </Section>

      <Section title="Reports">
        {reports.length ? (
          <ul className="grid gap-1.5">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <FileText className="size-4 shrink-0 text-brand-accent" />
                <a
                  href={r.blobUrl}
                  target="_blank"
                  rel="noopener"
                  className="min-w-0 flex-1 truncate hover:underline"
                  title={r.title}
                >
                  {r.title}
                </a>
                <span className="text-xs text-muted-foreground">
                  {timeAgo(r.createdAt)}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => downloadReport(r)}
                  aria-label={`Download ${r.title}`}
                >
                  <Download />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" />
            Ask Argus for a report once the route is traced.
          </p>
        )}
      </Section>
    </aside>
  );
}
