// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import { Cctv } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFloorplanStore } from "@/stores/floorplan";
import { autoMatchKeys } from "./keymap";
import { cameraName } from "@/stores/cameras";

const NONE = "__none";

/** Pair every floorplan camera key with a VSS camera tag. */
export function KeyMappingDialog({
  open,
  onOpenChange,
  tags,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tags: string[];
}) {
  const plan = useFloorplanStore((s) => s.plan);
  const keyMap = useFloorplanStore((s) => s.keyMap);
  const setMapping = useFloorplanStore((s) => s.setMapping);
  const setKeyMap = useFloorplanStore((s) => s.setKeyMap);
  const keys = Object.keys(plan.cameras);
  const sortedTags = useMemo(() => [...tags].sort(), [tags]);
  const mapped = keys.filter((k) => keyMap[k]).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map floorplan cameras</DialogTitle>
          <DialogDescription>
            Link each camera on the plan to the VSS camera tag it represents.
            Sightings from unmapped tags can't be drawn on the map.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-auto border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Plan camera</th>
                <th className="px-3 py-2 font-medium">Zone</th>
                <th className="px-3 py-2 font-medium">VSS camera</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2 font-mono text-xs">
                      <Cctv className="size-3.5 shrink-0 text-camera" />
                      {k}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {plan.cameras[k].zone ?? ""}
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      value={keyMap[k] ?? NONE}
                      onValueChange={(v) =>
                        setMapping(k, v === NONE ? undefined : v)
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-full"
                        aria-label={`VSS camera for ${k}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not mapped</SelectItem>
                        {sortedTags.map((t) => (
                          <SelectItem key={t} value={t}>
                            {cameraName(t)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {t}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {mapped} of {keys.length} mapped
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setKeyMap(autoMatchKeys(plan, tags))}
              disabled={!tags.length}
            >
              Auto-match
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
