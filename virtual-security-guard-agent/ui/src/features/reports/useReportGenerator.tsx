// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { getAdapters } from "@/adapters";
import { SpatialMap } from "@/features/map/SpatialMap";
import { planSize } from "@/features/map/geometry";
import { getThumbnail, toDataUrl } from "@/lib/thumbnails";
import { svgToPng } from "@/lib/svgRaster";
import { uid } from "@/lib/utils";
import { useFloorplanStore } from "@/stores/floorplan";
import { useReportsStore, type GeneratedReport } from "@/stores/reports";
import type { TraceStop } from "@/stores/case";
import { reportFileName, type ReportContent } from "./content";
import { useKnownTags } from "@/hooks/queries";

export interface GenerateArgs {
  report: ReportContent;
  stops: TraceStop[];
  subjectImage?: string;
  sessionId?: string;
}

async function stopThumb(s: TraceStop): Promise<string | undefined> {
  try {
    if (s.hit.posterUrl) return await toDataUrl(s.hit.posterUrl);
    if (s.hit.playbackUrl)
      return await toDataUrl(
        await getThumbnail(s.hit.playbackUrl, s.hit.seekS),
      );
  } catch {
    // a missing frame should not block the report
  }
  return undefined;
}

const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Builds incident PDFs. The route map is drawn by mounting a static
 * SpatialMap off-screen and rasterising it, so the PDF matches the UI.
 * Render `offscreen` somewhere in the tree.
 */
export function useReportGenerator() {
  const plan = useFloorplanStore((s) => s.plan);
  const vssTags = useKnownTags();
  const add = useReportsStore((s) => s.add);
  const [job, setJob] = useState<TraceStop[]>();
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const waiting = useRef<(v: SVGSVGElement | null) => void>(undefined);

  useEffect(() => {
    if (!job || !waiting.current) return;
    const resolve = waiting.current;
    void nextFrame().then(() => resolve(svg.current));
  }, [job]);

  const generate = useCallback(
    async (args: GenerateArgs): Promise<GeneratedReport> => {
      setBusy(true);
      try {
        let mapPng: string | undefined;
        if (args.stops.length) {
          const el = await new Promise<SVGSVGElement | null>((resolve) => {
            waiting.current = resolve;
            setJob(args.stops);
          });
          if (el) mapPng = await svgToPng(el).catch(() => undefined);
          setJob(undefined);
        }
        const thumbs: Record<number, string> = {};
        for (const s of args.stops.slice(0, 24)) {
          const t = await stopThumb(s);
          if (t) thumbs[s.order] = t;
        }
        const subjectImage = args.subjectImage
          ? await toDataUrl(args.subjectImage).catch(() => undefined)
          : undefined;
        const size = planSize(plan);
        const at = new Date();
        // jsPDF is large; load it only when a report is actually generated.
        const { buildReportPdf } = await import("./pdf");
        const doc = buildReportPdf({
          report: args.report,
          stops: args.stops,
          thumbs,
          subjectImage,
          mapPng,
          mapAspect: size.height / size.width,
          sessionId: getAdapters().mock ? undefined : args.sessionId,
          generatedAt: at,
        });
        const blob = doc.output("blob");
        const report: GeneratedReport = {
          id: uid("report"),
          title: args.report.title,
          preset: args.report.preset,
          fileName: reportFileName(args.report.title, at),
          createdAt: at.getTime(),
          size: blob.size,
          blobUrl: URL.createObjectURL(blob),
          sessionId: args.sessionId,
          stops: args.stops.length,
        };
        add(report);
        return report;
      } finally {
        setBusy(false);
      }
    },
    [plan, add],
  );

  const offscreen = job ? (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-[-12000px] w-[1000px] opacity-100"
    >
      <SpatialMap
        plan={plan}
        vssTags={vssTags}
        stops={job}
        animate={false}
        labels="route"
        svgRef={svg}
      />
    </div>
  ) : null;

  return { generate, busy, offscreen };
}

/** Save a generated report to disk. */
export function downloadReport(
  r: Pick<GeneratedReport, "blobUrl" | "fileName">,
) {
  const a = document.createElement("a");
  a.href = r.blobUrl;
  a.download = r.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
