// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Cctv,
  Clock3,
  ImagePlus,
  Loader2,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { localInputToIso } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useCamerasStore } from "@/stores/cameras";
import type { InvestigationPhase } from "@/stores/investigation";
import { firstImageFile, type Attachment } from "./useAttachment";

const PLACEHOLDER: Record<InvestigationPhase, string> = {
  idle: "Describe who to look for, or drop a photo of them",
  searching: "Argus is searching…",
  validating: "Review the matches above, or tell Argus how to refine",
  tracing: "Argus is tracing the route…",
  traced: "Ask for a handover report, an escalation, or a follow-up search",
  reporting: "Argus is drafting the report…",
};

const REPORT_CHIPS = [
  {
    label: "Handover report",
    prompt: "Write a handover report for the next shift.",
  },
  {
    label: "Escalation report",
    prompt: "Write an escalation report for the security manager.",
  },
  { label: "Short brief", prompt: "Give me a short brief of what happened." },
];

export interface ComposerSubmit {
  text: string;
  tags: string[];
  start?: string;
  end?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  phase: InvestigationPhase;
  busy: boolean;
  stopping: boolean;
  attachment?: Attachment;
  onAttach: (file: File) => void;
  onClearAttachment: () => void;
  onSubmit: (s: ComposerSubmit) => void;
  onStop: () => void;
}

function CameraScope({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
}) {
  const cameras = useCamerasStore((s) => s.cameras);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f
      ? cameras.filter((c) =>
          `${c.name} ${c.tag} ${c.location}`.toLowerCase().includes(f),
        )
      : cameras;
  }, [cameras, filter]);
  const toggle = (tag: string) =>
    onChange(
      tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    );

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "text-muted-foreground",
                tags.length && "text-brand-accent",
              )}
            >
              <Cctv />
              {tags.length
                ? `${tags.length} camera${tags.length > 1 ? "s" : ""}`
                : "All cameras"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Limit the search to specific cameras</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b p-2">
          <Input
            placeholder="Filter cameras"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
          />
        </div>
        <ul className="max-h-64 overflow-auto py-1">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                <Checkbox
                  checked={tags.includes(c.tag)}
                  onCheckedChange={() => toggle(c.tag)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.location}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {!shown.length && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              {cameras.length
                ? "No camera matches that filter."
                : "No cameras registered yet."}
            </li>
          )}
        </ul>
        <div className="flex justify-between border-t p-2">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => onChange([])}
            disabled={!tags.length}
          >
            Clear
          </Button>
          <span className="self-center text-xs text-muted-foreground">
            {tags.length ? `${tags.length} selected` : "Searching every camera"}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeWindow({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const active = !!(start || end);
  const invalid = !!(start && end && start >= end);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "text-muted-foreground",
                active && "text-brand-accent",
              )}
            >
              <Clock3 />
              {active ? "Time window set" : "Any time"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Limit the search to a time window</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="grid w-72 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="win-start">From</Label>
          <Input
            id="win-start"
            type="datetime-local"
            value={start}
            onChange={(e) => onChange(e.target.value, end)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="win-end">To</Label>
          <Input
            id="win-end"
            type="datetime-local"
            value={end}
            onChange={(e) => onChange(start, e.target.value)}
            aria-invalid={invalid}
          />
        </div>
        {invalid && (
          <p className="text-xs text-destructive">
            The end must be after the start.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Matches footage by when it was ingested into VSS, not by the camera
          clock.
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange("", "")}
          disabled={!active}
        >
          Clear window
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function AttachmentChip({
  a,
  onClear,
}: {
  a: Attachment;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 border bg-background p-1 pr-2 text-xs",
        a.status === "error" && "border-destructive/50",
      )}
    >
      {a.localUrl ? (
        <img src={a.localUrl} alt="" className="size-10 object-cover" />
      ) : (
        <div className="size-10 bg-muted" />
      )}
      <div className="min-w-0 max-w-48">
        <p className="truncate font-medium">{a.name}</p>
        <p
          className={cn(
            "flex items-center gap-1 text-muted-foreground",
            a.status === "error" && "text-destructive",
          )}
        >
          {a.status === "uploading" && (
            <>
              <Loader2 className="size-3 animate-spin" /> Uploading to VSS
            </>
          )}
          {a.status === "ready" && "Ready as search reference"}
          {a.status === "error" && (
            <>
              <TriangleAlert className="size-3 shrink-0" />
              <span className="truncate" title={a.error}>
                {a.error}
              </span>
            </>
          )}
        </p>
      </div>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={onClear}
        aria-label="Remove image"
      >
        <X />
      </Button>
    </div>
  );
}

/** Prompt box: text, reference image, camera scope and ingest-time window. */
export function Composer({
  value,
  onChange,
  phase,
  busy,
  stopping,
  attachment,
  onAttach,
  onClearAttachment,
  onSubmit,
  onStop,
}: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (!busy) textRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const uploading = attachment?.status === "uploading";
  const windowInvalid = !!(start && end && start >= end);
  const hasContent = !!value.trim() || attachment?.status === "ready";
  const canSend = !busy && hasContent && !uploading && !windowInvalid;

  function submit(text = value) {
    if (busy || uploading || windowInvalid) return;
    if (!text.trim() && attachment?.status !== "ready") return;
    onSubmit({
      text: text.trim(),
      tags,
      start: localInputToIso(start),
      end: localInputToIso(end),
    });
    setTags([]);
    setStart("");
    setEnd("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      {phase === "traced" && !busy && !value && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {REPORT_CHIPS.map((c) => (
            <Button
              key={c.label}
              type="button"
              size="xs"
              variant="outline"
              className="bg-background"
              onClick={() => submit(c.prompt)}
            >
              {c.label}
            </Button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border bg-background shadow-sm focus-within:border-brand-accent/60 focus-within:ring-2 focus-within:ring-brand-accent/15"
      >
        {attachment && (
          <div className="px-3 pt-3">
            <AttachmentChip a={attachment} onClear={onClearAttachment} />
          </div>
        )}
        <label htmlFor="argus-prompt" className="sr-only">
          Message Argus
        </label>
        <textarea
          id="argus-prompt"
          ref={textRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const file = firstImageFile(e.clipboardData.items);
            if (file) {
              e.preventDefault();
              onAttach(file);
            }
          }}
          placeholder={PLACEHOLDER[phase]}
          className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 font-prose text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAttach(f);
              e.target.value = "";
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach a reference image"
              >
                <ImagePlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Attach a reference image (or drop / paste one)
            </TooltipContent>
          </Tooltip>
          <CameraScope tags={tags} onChange={setTags} />
          <TimeWindow
            start={start}
            end={end}
            onChange={(s, e) => {
              setStart(s);
              setEnd(e);
            }}
          />
          <span className="flex-1" />
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Square className="fill-current" />
              )}
              {stopping ? "Stopping" : "Stop"}
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
      <p className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground">
        Argus can be wrong. Always confirm sightings against the footage before
        acting.
      </p>
    </div>
  );
}
