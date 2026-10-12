// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { StreamInput } from "@/adapters/vss/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Camera } from "@/stores/cameras";

interface FormState {
  streamUrl: string;
  name: string;
  location: string;
  tags: string;
  frameInterval: string;
  objectDetection: boolean;
}

const empty = (): FormState => ({
  streamUrl: "",
  name: "",
  location: "",
  tags: "",
  frameInterval: "15",
  objectDetection: true,
});

function validateStream(f: FormState, editing: boolean) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!editing) {
    const url = f.streamUrl.trim();
    if (!url) errors.streamUrl = "Enter the camera's RTSP URL.";
    else if (!/^rtsps?:\/\/[^\s/]+/i.test(url))
      errors.streamUrl = "Use an rtsp:// or rtsps:// URL.";
  }
  if (f.name.length > 120) errors.name = "Keep the name under 120 characters.";
  const n = Number(f.frameInterval);
  if (!Number.isInteger(n) || n < 1 || n > 60)
    errors.frameInterval = "Choose a whole number from 1 to 60.";
  return errors;
}

const splitTags = (s: string) =>
  s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Add a live RTSP camera to VSS, or edit one. */
export function CameraFormDialog({
  open,
  onOpenChange,
  camera,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  camera?: Camera;
  onSave: (input: StreamInput) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(empty);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const editing = !!camera;

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setSaveError(undefined);
    setForm(
      camera
        ? {
            streamUrl: camera.url,
            name: camera.name,
            location: camera.location,
            tags: camera.tags.join(", "),
            frameInterval: String(camera.frameInterval ?? 15),
            objectDetection: camera.objectDetection ?? true,
          }
        : empty(),
    );
  }, [open, camera]);

  const errors = validateStream(form, editing);
  const set =
    (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave({
        streamUrl: form.streamUrl.trim(),
        name: form.name.trim() || undefined,
        description: form.location.trim() || undefined,
        tags: splitTags(form.tags),
        frameInterval: Number(form.frameInterval),
        objectDetection: form.objectDetection,
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (
    k: keyof FormState,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`cam-${k}`}>{label}</Label>
      <Input
        id={`cam-${k}`}
        value={form[k] as string}
        onChange={set(k)}
        aria-invalid={touched && !!errors[k]}
        {...props}
      />
      {touched && errors[k] && (
        <p className="text-xs text-destructive">{errors[k]}</p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${camera.name}` : "Add live camera"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes apply to the running stream in VSS."
                : "VSS connects to the RTSP stream and starts indexing it for search."}
            </DialogDescription>
          </DialogHeader>
          {field("streamUrl", "RTSP URL", {
            placeholder: "rtsp://10.0.0.12:8554/lobby",
            disabled: editing,
            autoFocus: !editing,
            spellCheck: false,
          })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("name", "Name", { placeholder: "Lobby entrance" })}
            {field("location", "Location", { placeholder: "Level 4, lobby" })}
          </div>
          {field("tags", "Tags", { placeholder: "lobby, entry" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("frameInterval", "Index every N frames", {
              type: "number",
              min: 1,
              max: 60,
            })}
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch
                id="cam-od"
                checked={form.objectDetection}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, objectDetection: v }))
                }
              />
              <Label htmlFor="cam-od">Object detection</Label>
            </div>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? "Save changes" : "Add camera"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
