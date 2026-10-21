// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useInvestigations } from "@/hooks/queries";
import { formatBytes } from "@/lib/utils";
import { formatDateTime, timeAgo } from "@/lib/time";
import {
  discard,
  useReportsStore,
  type GeneratedReport,
} from "@/stores/reports";
import { PRESET_LABEL } from "./content";
import { downloadReport } from "./useReportGenerator";

function ReportPreviewDialog({
  report,
  onOpenChange,
}: {
  report?: GeneratedReport;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={!!report} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{report?.title}</DialogTitle>
          <DialogDescription>{report?.fileName}</DialogDescription>
        </DialogHeader>
        {report && (
          <iframe
            src={report.blobUrl}
            title={`Preview of ${report.title}`}
            className="min-h-0 w-full flex-1 border bg-muted"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" asChild>
            <a href={report?.blobUrl} target="_blank" rel="noopener">
              <ExternalLink /> Open in new tab
            </a>
          </Button>
          <Button onClick={() => report && downloadReport(report)}>
            <Download /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Generated({ onPreview }: { onPreview: (r: GeneratedReport) => void }) {
  const reports = useReportsStore((s) => s.reports);
  const clear = useReportsStore((s) => s.clear);
  const [clearing, setClearing] = useState(false);

  /** Remove at once; the PDF is freed only once Undo is no longer offered. */
  function removeReport(id: string) {
    const r = useReportsStore.getState().remove(id);
    if (!r) return;
    let undone = false;
    toast(`Removed "${r.title}"`, {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          useReportsStore.getState().restore(r);
        },
      },
      onAutoClose: () => !undone && discard(r),
      onDismiss: () => !undone && discard(r),
    });
  }

  return (
    <section className="border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileText className="size-4 text-brand-accent" />
        <h3 className="text-sm font-semibold">Generated in this tab</h3>
        <span className="text-xs text-muted-foreground">
          PDFs live in memory and are gone when you close or reload the tab.
        </span>
        <span className="flex-1" />
        {reports.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => setClearing(true)}>
            Clear all
          </Button>
        )}
      </header>
      {reports.length ? (
        <ul className="divide-y">
          {reports.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.createdAt)}, {r.stops} sighting
                  {r.stops === 1 ? "" : "s"}, {formatBytes(r.size)}
                </p>
              </div>
              <StatusChip tone="neutral">
                {PRESET_LABEL[r.preset as keyof typeof PRESET_LABEL] ??
                  r.preset}
              </StatusChip>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onPreview(r)}>
                  <Eye /> Preview
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadReport(r)}
                >
                  <Download /> Download
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => removeReport(r.id)}
                  aria-label={`Remove ${r.title}`}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No PDFs yet. Ask Argus for a report after tracing a subject, or open a
          past investigation below and generate its PDF there.
        </p>
      )}
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={`Remove all ${reports.length} reports?`}
        description="The PDFs are only kept in this browser tab, so they can't be recovered."
        action="Remove all"
        errorTitle="Couldn't remove the reports"
        onConfirm={clear}
      />
    </section>
  );
}

function Past() {
  const { data, isLoading, error, refetch, isFetching } = useInvestigations();
  const navigate = useNavigate();

  return (
    <section className="border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <FolderOpen className="size-4 text-brand-accent" />
        <h3 className="text-sm font-semibold">Past investigations</h3>
        <span className="text-xs text-muted-foreground">
          Stored as Argus sessions in Hermes. Open one to review it and generate
          its PDF.
        </span>
        <span className="flex-1" />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh"
        >
          <RefreshCw className={isFetching ? "animate-spin" : undefined} />
        </Button>
      </header>
      {isLoading ? (
        <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading investigations
        </p>
      ) : error ? (
        <p className="px-4 py-8 text-center text-sm text-destructive">
          Couldn't reach Hermes: {(error as Error).message}
        </p>
      ) : data?.length ? (
        <ul className="divide-y">
          {data.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.title || "Untitled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {timeAgo(s.lastActive ?? s.startedAt)}
                  {s.messageCount ? `, ${s.messageCount} messages` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate(`/argus?session=${encodeURIComponent(s.id)}`)
                }
              >
                Open in Argus
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No investigations yet.
        </p>
      )}
    </section>
  );
}

/** Incident reports: PDFs from this tab plus links to past investigations. */
export function ReportsPage() {
  const [preview, setPreview] = useState<GeneratedReport>();
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 p-4 md:p-6">
      <div>
        <h2 className="text-lg font-semibold">Incident reports</h2>
        <p className="text-sm text-muted-foreground">
          Reports are drafted by Argus, reviewed by you and exported as PDF in
          the browser.
        </p>
      </div>
      <Generated onPreview={setPreview} />
      <Past />
      <ReportPreviewDialog
        report={preview}
        onOpenChange={(o) => !o && setPreview(undefined)}
      />
    </div>
  );
}
