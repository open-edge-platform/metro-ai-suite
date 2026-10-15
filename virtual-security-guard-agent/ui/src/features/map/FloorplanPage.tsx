// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import {
  Cctv,
  Download,
  FileJson,
  Link2,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { StatusChip } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTags } from "@/hooks/queries";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useCamerasStore, cameraName } from "@/stores/cameras";
import { SAMPLE_FLOORPLAN, useFloorplanStore } from "@/stores/floorplan";
import { useTraceStore } from "@/stores/trace";
import { declaredKeyMap, unmappedKeys } from "./keymap";
import { KeyMappingDialog } from "./KeyMappingDialog";
import { layoutRoute } from "./route";
import { MAX_FLOORPLAN_BYTES, parseFloorplan } from "./schema";
import { SpatialMap } from "./SpatialMap";

/** The minimal floorplan from the product brief. */
const BRIEF_EXAMPLE = {
  cameras: {
    entry_cam_1: { x: 120, y: 450, zone: "Lobby", fov_angle: 90 },
    hall_cam_2: { x: 250, y: 450, zone: "Main Corridor", fov_angle: 45 },
    exit_cam3: { x: 600, y: 100, zone: "Back Alley", fov_angle: 120 },
  },
};

function downloadJson(data: unknown, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useKnownTags() {
  const cameras = useCamerasStore((s) => s.cameras);
  const { data: vssTags } = useTags();
  return useMemo(
    () => [...new Set([...cameras.map((c) => c.tag), ...(vssTags ?? [])])],
    [cameras, vssTags],
  );
}

/** Facility floorplan: upload, camera mapping and the latest traced route. */
export function FloorplanPage() {
  const { plan, keyMap, source, fileName, setPlan, reset } =
    useFloorplanStore();
  const trace = useTraceStore((s) => s.latest);
  const tags = useKnownTags();
  const [mappingOpen, setMappingOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [replay, setReplay] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stops = useMemo(() => trace?.stops ?? [], [trace]);
  const missing = unmappedKeys(plan, keyMap);
  const offMap = useMemo(
    () => layoutRoute(stops, plan, keyMap).offMap,
    [stops, plan, keyMap],
  );
  const cam = selected ? plan.cameras[selected] : undefined;

  async function load(file: File) {
    if (file.size > MAX_FLOORPLAN_BYTES) {
      toast.error("That file is too large", {
        description: "Floorplans must be under 5 MB.",
      });
      return;
    }
    const res = parseFloorplan(await file.text());
    if (!res.ok) {
      toast.error("That floorplan isn't valid", { description: res.error });
      return;
    }
    const map = declaredKeyMap(res.plan, tags);
    setPlan(res.plan, map, { source: "upload", fileName: file.name });
    setSelected(undefined);
    const gaps = unmappedKeys(res.plan, map).length;
    if (gaps) {
      toast.warning(`${gaps} camera${gaps > 1 ? "s" : ""} need mapping`, {
        description: "Link them to VSS cameras so sightings show on the map.",
      });
      setMappingOpen(true);
    } else toast.success("Floorplan loaded", { description: file.name });
  }

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) void load(f);
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <FileJson className="size-4 text-brand-accent" />
        <h2 className="text-sm font-semibold">
          {plan.name ?? fileName ?? "Floorplan"}
        </h2>
        <StatusChip tone="neutral">
          {source === "sample" ? "Sample plan" : fileName}
        </StatusChip>
        {missing.length > 0 && (
          <button type="button" onClick={() => setMappingOpen(true)}>
            <StatusChip tone="pending">
              <TriangleAlert /> {missing.length} unmapped
            </StatusChip>
          </button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setMappingOpen(true)}>
          <Link2 /> Map cameras
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <Download /> Samples
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                downloadJson(BRIEF_EXAMPLE, "example.floorplan.json")
              }
            >
              Minimal example (3 cameras)
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                downloadJson(SAMPLE_FLOORPLAN, "level4.floorplan.json")
              }
            >
              Level 4 sample with zones
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {source === "upload" && (
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw /> Use sample
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload /> Upload JSON
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="relative min-h-0 flex-1 overflow-auto p-4"
          {...dropProps}
        >
          <SpatialMap
            plan={plan}
            keyMap={keyMap}
            stops={stops}
            replayKey={replay}
            labels="all"
            selectedKey={selected}
            onCameraClick={(k) => setSelected((s) => (s === k ? undefined : k))}
            className="mx-auto max-h-[calc(100vh-10rem)] w-full max-w-6xl border"
            title={plan.name ?? "Facility floorplan"}
          />
          {dragging && (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center border-2 border-dashed border-brand-accent bg-background/80 text-sm font-medium text-brand-accent">
              Drop a floorplan JSON file
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 overflow-auto border-t bg-sidebar lg:w-80 lg:border-t-0 lg:border-l">
          <section className="border-b px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
              Camera
            </h3>
            {cam && selected ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Plan key</dt>
                <dd className="truncate font-mono text-xs leading-5">
                  {selected}
                </dd>
                <dt className="text-muted-foreground">Zone</dt>
                <dd>{cam.zone ?? "None"}</dd>
                <dt className="text-muted-foreground">VSS camera</dt>
                <dd className={cn(!keyMap[selected] && "text-pending")}>
                  {keyMap[selected]
                    ? cameraName(keyMap[selected])
                    : "Not mapped"}
                </dd>
                <dt className="text-muted-foreground">Position</dt>
                <dd className="tabular-nums">
                  {Math.round(cam.x)}, {Math.round(cam.y)}
                </dd>
                {cam.fov_angle && (
                  <>
                    <dt className="text-muted-foreground">Field of view</dt>
                    <dd>{cam.fov_angle}°</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cctv className="size-4" /> Select a camera on the map.
              </p>
            )}
          </section>

          <section className="px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Latest route
              </h3>
              {stops.length > 0 && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setReplay((r) => r + 1)}
                >
                  <RotateCcw /> Replay
                </Button>
              )}
            </div>
            {stops.length ? (
              <>
                <ol className="grid gap-1.5 text-sm">
                  {stops.map((s) => (
                    <li
                      key={s.order + s.hit.matchId}
                      className="flex items-center gap-2"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-track text-[0.6875rem] font-bold text-white">
                        {s.order}
                      </span>
                      <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatClock(s.at)}
                      </span>
                      <span className="truncate">
                        {s.hit.cameraTag
                          ? cameraName(s.hit.cameraTag)
                          : s.hit.videoName}
                      </span>
                    </li>
                  ))}
                </ol>
                {offMap.length > 0 && (
                  <p className="mt-3 text-xs text-pending">
                    {offMap.length} sighting
                    {offMap.length > 1 ? "s are" : " is"} on cameras that aren't
                    on this plan.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No route yet. Confirm a sighting in{" "}
                <Link to="/argus" className="text-brand-accent hover:underline">
                  Argus
                </Link>{" "}
                to trace it here.
              </p>
            )}
          </section>
        </aside>
      </div>

      <KeyMappingDialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        tags={tags}
      />
    </div>
  );
}
