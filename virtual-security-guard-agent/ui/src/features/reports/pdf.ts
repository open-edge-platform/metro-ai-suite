// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { jsPDF } from "jspdf";
import { hitMatchesRef } from "@/lib/hits";
import {
  formatClock,
  formatDateTime,
  formatDay,
  formatGap,
  formatOffset,
} from "@/lib/time";
import { movementLegs, type TraceStop } from "@/stores/trace";
import { PRESET_LABEL, type ReportContent } from "./content";
import { cameraName } from "@/stores/cameras";

export interface ReportPdfInput {
  report: ReportContent;
  /** Ordered route (buildTrace). */
  stops: TraceStop[];
  /** Thumbnail data URLs keyed by stop order. */
  thumbs?: Record<number, string>;
  /** Subject reference image as a data URL. */
  subjectImage?: string;
  /** Rasterised SpatialMap (PNG data URL). */
  mapPng?: string;
  mapAspect?: number;
  sessionId?: string;
  /** Camera tag -> human name (from the fleet). */
  cameraName?: (tag: string) => string | undefined;
  generatedAt?: Date;
}

// Intel palette (sRGB) for print.
const CLASSIC_BLUE: [number, number, number] = [0, 84, 174];
const CORAL: [number, number, number] = [218, 46, 86];
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 110, 110];
const RULE: [number, number, number] = [210, 210, 210];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const W = PAGE_W - 2 * M;

function imgFormat(dataUrl: string) {
  return /^data:image\/png/i.test(dataUrl) ? "PNG" : "JPEG";
}

/**
 * Incident PDF: header band, narrative, subject, route map, sightings table
 * with thumbnails (in time order), the subject's movement between cameras
 * with the elapsed time of each leg, observations and recommended actions.
 * Only sightings the operator confirmed appear; nothing is inferred beyond
 * them.
 */
export function buildReportPdf(input: ReportPdfInput): jsPDF {
  const { report, stops } = input;
  const at = input.generatedAt ?? new Date();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 0;

  const ensure = (h: number) => {
    if (y + h > PAGE_H - 18) {
      doc.addPage();
      y = 18;
    }
  };
  const heading = (text: string) => {
    ensure(12);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...CLASSIC_BLUE);
    doc.text(text, M, y);
    y += 2;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, y, M + W, y);
    y += 5;
  };
  const paragraph = (text: string, size = 10, color = INK) => {
    if (!text.trim()) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text.trim(), W) as string[];
    for (const line of lines) {
      ensure(5);
      doc.text(line, M, y);
      y += size * 0.45;
    }
    y += 1.5;
  };
  const bullets = (items: string[]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    for (const item of items.filter((i) => i.trim())) {
      const lines = doc.splitTextToSize(item.trim(), W - 5) as string[];
      lines.forEach((line, i) => {
        ensure(5);
        if (i === 0) doc.text("•", M + 1, y);
        doc.text(line, M + 5, y);
        y += 4.5;
      });
      y += 0.8;
    }
  };

  // Header band
  doc.setFillColor(...CLASSIC_BLUE);
  doc.rect(0, 0, PAGE_W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Virtual Security Guard Agent", M, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Incident report prepared with Argus and Intel VSS", M, 16);
  doc.text(`${PRESET_LABEL[report.preset]} report`, PAGE_W - M, 10, {
    align: "right",
  });
  doc.text(`${formatDateTime(at)}, ${formatClock(at)}`, PAGE_W - M, 16, {
    align: "right",
  });
  y = 34;

  // Title + meta
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  for (const line of doc.splitTextToSize(report.title, W) as string[]) {
    doc.text(line, M, y);
    y += 7;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const meta = [
    `Confidence: ${report.confidence}`,
    `${stops.length} verified sighting${stops.length === 1 ? "" : "s"}`,
    input.sessionId ? `Session ${input.sessionId}` : undefined,
  ].filter(Boolean);
  doc.text(meta.join("    "), M, y);
  y += 6;

  heading("Summary");
  paragraph(report.summary || "No summary provided.");

  if (report.subject || input.subjectImage) {
    heading("Subject");
    const imgW = input.subjectImage ? 34 : 0;
    const startY = y;
    if (input.subjectImage) {
      ensure(imgW * 1.1);
      try {
        doc.addImage(
          input.subjectImage,
          imgFormat(input.subjectImage),
          M,
          y - 2,
          imgW,
          imgW * 0.75,
        );
      } catch {
        // unsupported image; the description still stands
      }
    }
    if (report.subject) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(
        report.subject,
        W - imgW - 4,
      ) as string[];
      let ty = y + 2;
      for (const line of lines) {
        doc.text(line, M + imgW + (imgW ? 4 : 0), ty);
        ty += 4.5;
      }
      y = Math.max(ty, startY + imgW * 0.75) + 2;
    } else y = startY + imgW * 0.75 + 2;
  }

  if (input.mapPng) {
    heading("Route");
    const h = W * (input.mapAspect ?? 0.62);
    ensure(h + 4);
    doc.addImage(input.mapPng, "PNG", M, y, W, h);
    y += h + 4;
  }

  heading("Verified sightings, in time order");
  if (!stops.length)
    paragraph("No sightings passed the relevance threshold.", 10, MUTED);
  const noteFor = (s: TraceStop) =>
    report.timeline.find((t) => t.ref && hitMatchesRef(s.hit, t.ref))?.note;
  const rowH = 16;
  stops.forEach((s) => {
    ensure(rowH + 2);
    const tag = s.hit.cameraTag;
    const name = tag
      ? (input.cameraName?.(tag) ?? cameraName(tag))
      : "Unknown camera";
    // order marker
    doc.setFillColor(...CORAL);
    doc.circle(M + 3, y + 3, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(String(s.order), M + 3, y + 4.1, { align: "center" });
    const thumb = input.thumbs?.[s.order];
    const tx = M + 9;
    if (thumb) {
      try {
        doc.addImage(thumb, imgFormat(thumb), tx, y, 24, 13.5);
      } catch {
        // skip a bad frame
      }
    }
    const cx = tx + 28;
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(
      `${s.at ? `${formatDay(s.at)}  ` : ""}${formatClock(s.at)}  ${name}`,
      cx,
      y + 3.5,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `${s.hit.matchId}   ${tag ?? ""}   segment ${formatOffset(s.hit.startS)} to ${formatOffset(s.hit.endS)}   relevance ${Math.round(s.hit.score * 100)}%`,
      cx,
      y + 7.5,
    );
    const note = noteFor(s);
    if (note) {
      doc.setTextColor(...INK);
      const line = (doc.splitTextToSize(note, M + W - cx) as string[])[0];
      doc.text(line, cx, y + 11.5);
    }
    y += rowH;
  });
  const extra = report.timeline.filter(
    (t) => !t.ref || !stops.some((s) => hitMatchesRef(s.hit, t.ref!)),
  );
  if (extra.length) {
    y += 2;
    bullets(extra.map((t) => (t.ref ? `${t.ref}: ${t.note}` : t.note)));
  }

  const legs = movementLegs(stops);
  if (legs.length) {
    heading("Movement");
    const camOf = (st: TraceStop) =>
      st.hit.cameraTag
        ? (input.cameraName?.(st.hit.cameraTag) ?? cameraName(st.hit.cameraTag))
        : "Unknown camera";
    bullets(
      legs.map(
        (l) =>
          `${l.from.order} to ${l.to.order}: ${
            l.sameCamera
              ? `stayed on ${camOf(l.to)}`
              : `${camOf(l.from)} to ${camOf(l.to)}`
          }, ${formatGap(l.gapS)} (${formatClock(l.from.at)} to ${formatClock(l.to.at)}).`,
      ),
    );
    const first = stops[0].at;
    const last = stops[stops.length - 1].at;
    if (first && last)
      paragraph(
        `First seen ${formatDay(first)} ${formatClock(first)}; last seen ${formatDay(last)} ${formatClock(last)} (${formatGap((last.getTime() - first.getTime()) / 1000)} in total).`,
        9,
        MUTED,
      );
  }

  if (report.observations.length) {
    heading("Observations");
    bullets(report.observations);
  }
  if (report.actions.length) {
    heading("Recommended actions");
    bullets(report.actions);
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.line(M, PAGE_H - 12, M + W, PAGE_H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      "Sightings were confirmed by an operator. Times follow VSS ingest time. Describes clothing and movement only.",
      M,
      PAGE_H - 7,
    );
    doc.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - 7, { align: "right" });
  }
  return doc;
}
