// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * CameraDashboardPage
 * --------------------
 * Minimal, read-only-context embed view opened by a VMS (Milestone
 * Management Client, Nx Web Page, …) for ONE specific camera.
 *
 * Unlike the full VAP dashboard, the camera and analytics app are fixed —
 * resolved once from the URL/config and never editable here. The operator
 * can only pick the inference device and start/stop that one pipeline.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Camera, PlayCircle, StopCircle, Loader2, AlertCircle } from 'lucide-react';

import {
  listCameras, discoverCameras, discoverAnalyticsApps, startAnalyticsApp, stopAnalyticsAppRun,
  listAnalyticsAppRuns,
} from '@/services/api';
import ZoneEditor from './ZoneEditor';
import { toZonePoints, validateZonePoints, zoneToJson } from './zonePoints';

// Pipeline states in which a run still occupies the camera.
const ACTIVE_RUN_STATES = new Set(['QUEUED', 'RUNNING']);
// How often the page re-checks the camera's run, so it follows starts/stops made elsewhere.
const RUN_SYNC_INTERVAL_MS = 5000;

/** The active run of this camera, from the app's run listing (VAP tags runs with camera_id). */
function findCameraRun(runs, cameraId, ignoredIds) {
  if (!Array.isArray(runs)) return null;
  return runs.find((r) => r.camera_id === cameraId && ACTIVE_RUN_STATES.has(r.state)
    && !ignoredIds.has(r.id ?? r.run_id)) ?? null;
}

export default function CameraDashboardPage({ cameraId, appId: appIdOverride }) {
  const [camera, setCamera]   = useState(null);
  const [app, setApp]         = useState(null);
  const [device, setDevice]   = useState('');
  // Zone points as editable [x, y] strings; the config default is kept for "Reset".
  const [zonePoints, setZonePoints] = useState([]);
  const [defaultZone, setDefaultZone] = useState([]);
  const [runId, setRunId]     = useState(null);
  const runIdRef = useRef(null);
  const stoppedRunIds = useRef(new Set());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError]     = useState(null);

  /** Show `run` (or no run) as this camera's state; adopt its device and zone when it is new. */
  function applyRun(run) {
    const id = run ? (run.id ?? run.run_id) : null;
    if (id && id !== runIdRef.current) {
      if (run.device) setDevice(run.device);
      if (run.zone) setZonePoints(toZonePoints(run.zone));
    }
    runIdRef.current = id;
    setRunId(id);
  }

  // Resolve the fixed camera + analytics app once on mount — neither is
  // re-derivable from user input on this page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let [cameras, apps] = await Promise.all([listCameras(), discoverAnalyticsApps()]);
        if (cancelled) return;

        // Opened directly from the VMS — nobody has necessarily run Discover
        // on the main dashboard yet. Trigger an active scan once before
        // giving up, so this page works standalone.
        if (!cameras.some((c) => c.camera_id === cameraId)) {
          cameras = await discoverCameras();
          if (cancelled) return;
        }

        const foundCamera = cameras.find((c) => c.camera_id === cameraId) || null;
        if (!foundCamera) {
          setError(`Camera '${cameraId}' was not found on any connected VMS.`);
          return;
        }

        const foundApp = appIdOverride
          ? apps.find((a) => a.app_id === appIdOverride)
          : apps[0];
        if (!foundApp || !foundApp.available || !foundApp.params_schema) {
          setError('No reachable analytics app is configured for this camera.');
          return;
        }

        setCamera(foundCamera);
        setApp(foundApp);
        const deviceSchema = foundApp.params_schema.properties?.device ?? {};
        setDevice(deviceSchema.default ?? (deviceSchema.enum ?? [])[0] ?? '');
        // Pre-filled from default_zone_polygon in VAP's config.yaml.
        const configured = toZonePoints(foundApp.params_schema.properties?.zone?.default);
        setDefaultZone(configured);
        setZonePoints(configured);

        // A pipeline may already be running for this camera (e.g. the page was reopened).
        const runs = await listAnalyticsAppRuns(foundApp.app_id).catch(() => []);
        if (cancelled) return;
        applyRun(findCameraRun(runs, cameraId, stoppedRunIds.current));
      } catch (err) {
        if (!cancelled) setError(err.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cameraId, appIdOverride]);

  // Keep the Start/Stop state in step with the pipeline, including starts and
  // stops made elsewhere (VAP dashboard, API) or a pipeline that ended.
  useEffect(() => {
    if (!app) return undefined;
    let cancelled = false;
    const sync = async () => {
      try {
        const runs = await listAnalyticsAppRuns(app.app_id);
        if (!cancelled) applyRun(findCameraRun(runs, cameraId, stoppedRunIds.current));
      } catch { /* keep the current state until the next check */ }
    };
    const timer = setInterval(sync, RUN_SYNC_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [app, cameraId]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const payload = { camera_id: camera.camera_id, device };
      if (zonePoints.length) payload.zone = zoneToJson(zonePoints);
      const res = await startAnalyticsApp(app.app_id, payload);
      runIdRef.current = res.run_id ?? res.runId ?? null;
      setRunId(runIdRef.current);
      toast.success(`${app.display_name} started`);
    } catch (err) {
      toast.error(`Failed to start: ${err.message ?? err}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopAnalyticsAppRun(app.app_id, runId);
      // The listing may show the run for a moment longer; don't flip back to Stop.
      stoppedRunIds.current.add(runId);
      runIdRef.current = null;
      setRunId(null);
      toast.success(`${app.display_name} stopped`);
    } catch (err) {
      toast.error(`Failed to stop: ${err.message ?? err}`);
    }
  };

  // Embedded in XProtect Management Client's Properties pane: wide but only
  // ~230 px tall, so everything is top-aligned and compact, with Start/Stop in
  // the header so it is always visible without scrolling.
  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-[#EEF2FA] px-3 py-2 text-[0.8rem] text-[#4A5C80]">
        <Loader2 size={15} className="animate-spin text-[#0071C5]" />Loading camera…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#EEF2FA] p-2">
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[0.8rem] text-red-800">
          <AlertCircle size={15} className="mt-[1px] shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const deviceOptions = app.params_schema.properties?.device?.enum ?? [];
  const zoneSchema = app.params_schema.properties?.zone;
  const zoneError = validateZonePoints(zonePoints);
  const isRunning = !!runId;

  return (
    <div className="min-h-screen bg-[#EEF2FA] p-2 text-[#0E1C47]">
      <Toaster position="top-right" />
      <div className="rounded-md border border-[#E3E8F4] bg-white">
        {/* Header: camera, app, run state and Start/Stop */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EDF0F9] px-3 py-[6px]">
          <Camera size={15} className="shrink-0 text-[#0071C5]" />
          <span className="min-w-0 truncate text-[0.85rem] font-semibold" title={camera.camera_id}>
            {camera.name || camera.camera_id}
          </span>
          <span className="vms-badge vms-badge-blue-dk">{app.display_name}</span>
          <span className={`text-[0.72rem] font-semibold ${isRunning ? 'text-green-700' : 'text-[#8695B8]'}`}>
            {isRunning ? '● Running' : '○ Stopped'}
          </span>
          <div className="ml-auto">
            {isRunning ? (
              <Button size="sm" variant="destructive" className="h-7 px-3 text-[0.78rem] font-semibold"
                onClick={handleStop}>
                <StopCircle size={13} className="mr-1" />Stop
              </Button>
            ) : (
              <Button size="sm" className="h-7 bg-[#0071C5] px-3 text-[0.78rem] font-semibold text-white hover:bg-[#005BA0]"
                onClick={handleStart} disabled={starting || !device || !!zoneError}
                title={zoneError || undefined}>
                {starting
                  ? <><Loader2 size={13} className="mr-1 animate-spin" />Starting…</>
                  : <><PlayCircle size={13} className="mr-1" />Start</>}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-[6px] px-3 py-[7px]">
          {/* Device */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="shrink-0 text-[0.66rem] sm:w-[6.5rem] font-bold uppercase tracking-wide text-[#8695B8]">Device</span>
            <RadioGroup value={device} onValueChange={setDevice} className="flex flex-row flex-wrap gap-[6px]">
              {deviceOptions.map((opt) => {
                const isActive = device === opt;
                return (
                  <Label key={opt} htmlFor={`cd-${opt}`}
                    className={`flex h-7 cursor-pointer items-center gap-[6px] rounded-md border px-[10px] ${isActive ? 'border-[#0071C5] bg-[#F0F7FF]' : 'border-[#E3E8F4]'}`}>
                    <RadioGroupItem id={`cd-${opt}`} value={opt} className="sr-only" disabled={isRunning} />
                    <span className={`vms-radio-dot ${isActive ? 'vms-radio-dot-active' : ''}`} />
                    <span className={`text-[0.78rem] font-semibold ${isActive ? 'text-[#0E1C47]' : 'text-[#4A5C80]'}`}>{opt}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          {/* Loitering zone: sketch with each point's X/Y boxes at its corner */}
          {zoneSchema && (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
              <span className="shrink-0 text-[0.66rem] sm:w-[6.5rem] sm:pt-[7px] font-bold uppercase tracking-wide text-[#8695B8]">
                {zoneSchema.title || 'Zone'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <ZoneEditor
                  points={zonePoints}
                  defaultPoints={defaultZone}
                  disabled={isRunning}
                  onChange={setZonePoints}
                />
                {zoneError ? (
                  <span className="text-[0.7rem] text-red-600">{zoneError}</span>
                ) : (
                  <span className="text-[0.7rem] leading-snug text-[#6B7A99]">
                    Each numbered point is a corner of the zone, as a fraction of the video frame:{' '}
                    <b className="font-semibold">X</b> 0 = left edge → 1 = right edge,{' '}
                    <b className="font-semibold">Y</b> 0 = top edge → 1 = bottom edge. Points are joined in
                    number order and scaled to this camera&apos;s resolution on Start.
                    {isRunning && ' Stop the pipeline to change the zone.'}
                    {!isRunning && zonePoints.length === 0 && ' No points: the zone configured in VAP is used.'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
