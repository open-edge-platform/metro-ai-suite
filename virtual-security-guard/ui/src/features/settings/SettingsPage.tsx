// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Database,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getAdapters } from "@/adapters";
import { StatusChip } from "@/components/shared/media";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { env } from "@/config/env";
import { useHealth } from "@/hooks/queries";
import { PROTOCOL_VERSION } from "@/protocol/directives";
import { useFloorplanStore } from "@/stores/floorplan";
import { SETTINGS_DEFAULTS, useSettingsStore } from "@/stores/settings";

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="size-4 text-brand-accent" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="grid gap-4 p-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const reach = (ok: boolean | undefined, loading: boolean) =>
  loading ? (
    <StatusChip tone="neutral">Checking</StatusChip>
  ) : ok ? (
    <StatusChip tone="success">Reachable</StatusChip>
  ) : (
    <StatusChip tone="error">Unreachable</StatusChip>
  );

function Connections() {
  const health = useHealth();
  const features = useQuery({
    queryKey: ["vss", "features"],
    queryFn: () => getAdapters().vss.features(),
    staleTime: 60_000,
  });
  const f = features.data;
  return (
    <Panel icon={Bot} title="Connections">
      <Row
        label="Hermes agent API"
        hint={`Proxied through ${env.hermesBase}. The API key is added by the server, never by the browser.`}
      >
        {reach(health.data?.hermes, health.isLoading)}
      </Row>
      <Row
        label="VSS gateway"
        hint={`Proxied through ${env.vssBase}/manager and ${env.vssBase}/datastore.`}
      >
        {reach(health.data?.vss, health.isLoading)}
      </Row>
      <Row
        label="VSS capabilities"
        hint="Argus needs the search pipeline. Summary is optional."
      >
        <div className="flex gap-1.5">
          {features.isLoading ? (
            <StatusChip tone="neutral">Checking</StatusChip>
          ) : f ? (
            <>
              <StatusChip tone={f.search ? "success" : "error"}>
                Search
              </StatusChip>
              <StatusChip
                tone={
                  f.imageSearch === false
                    ? "pending"
                    : f.search
                      ? "success"
                      : "neutral"
                }
              >
                Image search
              </StatusChip>
              <StatusChip tone={f.summary ? "success" : "neutral"}>
                Summary
              </StatusChip>
            </>
          ) : (
            <StatusChip tone="error">Unknown</StatusChip>
          )}
        </div>
      </Row>
      <Row
        label="Directive protocol"
        hint="Must match the virtual-security-guard skill installed in Hermes."
      >
        <StatusChip tone="info">v{PROTOCOL_VERSION}</StatusChip>
      </Row>
      {env.useMocks && (
        <p className="border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Mock mode is on: Hermes and VSS are simulated with a scripted
          investigation.
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void health.refetch();
            void features.refetch();
          }}
          disabled={health.isFetching}
        >
          <RefreshCw
            className={health.isFetching ? "animate-spin" : undefined}
          />{" "}
          Check again
        </Button>
      </div>
    </Panel>
  );
}

function Investigation() {
  const s = useSettingsStore();
  return (
    <Panel icon={SlidersHorizontal} title="Investigation">
      <Row
        label={
          <Label htmlFor="min-score">Minimum score to join the route</Label>
        }
        hint="VSS relevance is normalised so the best hit scores 1.0. Lower values trace more sightings but add noise."
      >
        <div className="flex items-center gap-3">
          <input
            id="min-score"
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={s.minTraceScore}
            onChange={(e) => s.setMinTraceScore(Number(e.target.value))}
            className="w-40 accent-[var(--color-brand-accent)]"
          />
          <span className="w-10 text-right text-sm tabular-nums">
            {s.minTraceScore.toFixed(2)}
          </span>
        </div>
      </Row>
      <Row
        label={<Label htmlFor="limit">Matches per search</Label>}
        hint="How many candidates Argus asks VSS for, and how many the review grid shows."
      >
        <Input
          id="limit"
          type="number"
          min={4}
          max={50}
          value={s.searchLimit}
          onChange={(e) => s.setSearchLimit(Number(e.target.value))}
          className="w-24"
        />
      </Row>
      <Row
        label={<Label htmlFor="watch-min">Live watch time limit</Label>}
        hint="Minutes before a live watch stops by itself."
      >
        <Input
          id="watch-min"
          type="number"
          min={1}
          max={240}
          value={s.watchMinutes}
          onChange={(e) => s.setWatchMinutes(Number(e.target.value))}
          className="w-24"
        />
      </Row>
      <Row
        label={<Label htmlFor="watch-idle">Stop when quiet for</Label>}
        hint="Minutes without a new live sighting before the watch stops."
      >
        <Input
          id="watch-idle"
          type="number"
          min={1}
          max={120}
          value={s.watchIdleMinutes}
          onChange={(e) => s.setWatchIdleMinutes(Number(e.target.value))}
          className="w-24"
        />
      </Row>
      <Row
        label={<Label htmlFor="casefile">Show the case file</Label>}
        hint="Side panel in Argus on wide screens."
      >
        <Switch
          id="casefile"
          checked={s.caseFileOpen}
          onCheckedChange={s.setCaseFileOpen}
        />
      </Row>
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={s.reset}
          disabled={
            s.minTraceScore === SETTINGS_DEFAULTS.minTraceScore &&
            s.searchLimit === SETTINGS_DEFAULTS.searchLimit &&
            s.watchMinutes === SETTINGS_DEFAULTS.watchMinutes &&
            s.watchIdleMinutes === SETTINGS_DEFAULTS.watchIdleMinutes &&
            s.caseFileOpen === SETTINGS_DEFAULTS.caseFileOpen
          }
        >
          <RotateCcw /> Restore defaults
        </Button>
      </div>
    </Panel>
  );
}

function LocalData() {
  const [confirm, setConfirm] = useState(false);
  const resetPlan = useFloorplanStore((s) => s.reset);
  const resetSettings = useSettingsStore((s) => s.reset);

  async function wipe() {
    resetPlan();
    resetSettings();
    setConfirm(false);
    toast.success("Local data cleared");
  }

  return (
    <Panel icon={Database} title="Data in this browser">
      <p className="text-sm text-muted-foreground">
        The floorplan and these settings are stored in this browser.
        Investigations live in Hermes; cameras, footage and search results live
        in VSS. Neither is affected here.
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
          <Trash2 /> Clear local data
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear local data?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the uploaded floorplan and its camera mapping, and resets
              settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void wipe();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-4 md:p-6">
      <Connections />
      <Investigation />
      <LocalData />
    </div>
  );
}
