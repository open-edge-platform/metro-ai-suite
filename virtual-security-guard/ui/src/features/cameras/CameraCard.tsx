// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  Cctv,
  MoreVertical,
  Network,
  Pause,
  Pencil,
  Play,
  Radio,
  Trash2,
} from "lucide-react";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Camera } from "@/stores/cameras";
import { STATUS_META } from "./status";

const num = new Intl.NumberFormat();

/** One VSS RTSP stream: state, ingest stats and controls. */
export function CameraCard({
  camera,
  onEdit,
  onTogglePause,
  onDelete,
}: {
  camera: Camera;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const meta = STATUS_META[camera.status];
  const paused = camera.status === "paused";
  return (
    <article
      className={cn(
        "group flex flex-col border bg-card transition-colors hover:border-brand-accent/40",
        camera.status === "offline" && "opacity-80",
      )}
    >
      <div className="relative flex aspect-video flex-col items-center justify-center gap-1.5 overflow-hidden bg-blueprint text-blueprint-ink/70">
        <Radio
          className={cn(
            "size-7",
            camera.status === "live" &&
              "text-success motion-safe:animate-pulse",
          )}
        />
        <span className="text-xs">
          {camera.status === "live"
            ? `Indexing every ${camera.frameInterval ?? "?"} frames`
            : camera.status === "paused"
              ? "Ingest paused"
              : camera.status === "starting"
                ? "Connecting to the camera"
                : (camera.error ?? "No frames received")}
        </span>
        <div className="absolute top-2 left-2 rounded-sm bg-background">
          <StatusChip tone={meta.tone}>
            {camera.status === "live" && (
              <span className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            )}
            {meta.label}
          </StatusChip>
        </div>
        {camera.lastFrameAt && (
          <span className="absolute right-2 bottom-2 bg-black/60 px-1.5 py-0.5 text-[0.6875rem] text-white">
            Last frame {timeAgo(camera.lastFrameAt)}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 p-3">
        <Cctv className="mt-0.5 size-4 shrink-0 text-camera" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={camera.name}>
            {camera.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {camera.location || "No location"}
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onTogglePause}
          aria-label={paused ? `Resume ${camera.name}` : `Pause ${camera.name}`}
          title={paused ? "Resume ingest" : "Pause ingest"}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Actions for ${camera.name}`}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t px-3 py-2 text-xs">
        <dt className="flex items-center gap-1 text-muted-foreground">
          <Network className="size-3" /> Host
        </dt>
        <dd className="truncate font-mono">{camera.ip || "Unknown"}</dd>
        <dt className="text-muted-foreground">Stream ID</dt>
        <dd className="truncate font-mono" title={camera.streamId}>
          {camera.streamId}
        </dd>
        <dt className="text-muted-foreground">Frames</dt>
        <dd>
          {num.format(camera.framesProcessed ?? 0)} processed,{" "}
          {num.format(camera.embeddingsCreated ?? 0)} indexed
        </dd>
        {!!camera.tags.length && (
          <>
            <dt className="text-muted-foreground">Tags</dt>
            <dd className="truncate" title={camera.tags.join(", ")}>
              {camera.tags.join(", ")}
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}
