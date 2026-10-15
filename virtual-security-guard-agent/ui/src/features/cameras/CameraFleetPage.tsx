// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { Cctv, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { StreamInput } from "@/adapters/vss/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCamerasStore,
  type Camera,
  type CameraStatus,
} from "@/stores/cameras";
import { CameraCard } from "./CameraCard";
import { STATUS_META } from "./status";
import { CameraFormDialog } from "./CameraFormDialog";

const POLL_MS = 10_000;

/** Live cameras: the RTSP streams VSS is ingesting, with add/edit/pause/remove. */
export function CameraFleetPage() {
  const { cameras, loaded, error, load, add, update, remove } =
    useCamerasStore();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Camera | "new">();
  const [deleting, setDeleting] = useState<Camera>();
  const [removing, setRemoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return cameras
      .filter(
        (c) =>
          !f ||
          `${c.name} ${c.streamId} ${c.location} ${c.ip ?? ""} ${c.tags.join(" ")}`
            .toLowerCase()
            .includes(f),
      )
      .sort(
        (a, b) =>
          a.location.localeCompare(b.location) || a.name.localeCompare(b.name),
      );
  }, [cameras, filter]);
  const tally = useMemo(() => {
    const t: Record<CameraStatus, number> = {
      live: 0,
      starting: 0,
      paused: 0,
      offline: 0,
    };
    cameras.forEach((c) => t[c.status]++);
    return t;
  }, [cameras]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    const err = useCamerasStore.getState().error;
    if (err) toast.error("Couldn't reach VSS", { description: err });
  }

  async function togglePause(c: Camera) {
    const state = c.status === "paused" ? "running" : "paused";
    try {
      await update(c.streamId, { state });
      toast.success(
        state === "paused" ? `Paused ${c.name}` : `Resumed ${c.name}`,
      );
    } catch (e) {
      toast.error("Couldn't change the camera", {
        description: (e as Error).message,
      });
    }
  }

  async function save(input: StreamInput) {
    if (editing === "new") {
      await add(input);
      toast.success(`Added ${input.name ?? "camera"}`);
    } else if (editing) {
      await update(editing.streamId, {
        name: input.name,
        description: input.description ?? "",
        tags: input.tags,
        frameInterval: input.frameInterval,
        objectDetection: input.objectDetection,
      });
      toast.success(`Saved ${input.name ?? editing.name}`);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await remove(deleting.streamId);
      toast.success(`Removed ${deleting.name}`);
      setDeleting(undefined);
    } catch (e) {
      toast.error("Couldn't remove the camera", {
        description: (e as Error).message,
      });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Live cameras</h2>
          <p className="text-sm text-muted-foreground">
            {cameras.length} cameras
            {(Object.keys(tally) as (keyof typeof tally)[])
              .filter((k) => tally[k])
              .map((k) => `, ${tally[k]} ${STATUS_META[k].label.toLowerCase()}`)
              .join("")}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, tag, location or IP"
            className="w-72 pl-8"
            aria-label="Filter cameras"
          />
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh"
        >
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add camera
        </Button>
      </div>

      {error && !cameras.length && (
        <p className="mb-4 text-sm text-destructive">
          Couldn't reach VSS: {error}
        </p>
      )}

      {!loaded ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-none" />
          ))}
        </div>
      ) : shown.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
          {shown.map((c) => (
            <CameraCard
              key={c.streamId}
              camera={c}
              onEdit={() => setEditing(c)}
              onTogglePause={() => void togglePause(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 border border-dashed py-16 text-center">
          <Cctv className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {cameras.length
              ? "No camera matches that filter."
              : "No live cameras yet. Add an RTSP camera, or ask Argus to add one."}
          </p>
          {!cameras.length && (
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus /> Add camera
            </Button>
          )}
        </div>
      )}

      <CameraFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(undefined)}
        camera={editing === "new" ? undefined : editing}
        onSave={save}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              VSS stops ingesting this RTSP stream. Footage and embeddings
              already indexed stay searchable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={removing}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {removing && <Loader2 className="animate-spin" />}
              Remove camera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
