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

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Camera, PlayCircle, StopCircle, Loader2, AlertCircle } from 'lucide-react';

import { listCameras, discoverCameras, discoverAnalyticsApps, startAnalyticsApp, stopAnalyticsAppRun } from '@/services/api';

export default function CameraDashboardPage({ cameraId, appId: appIdOverride }) {
  const [camera, setCamera]   = useState(null);
  const [app, setApp]         = useState(null);
  const [device, setDevice]   = useState('');
  const [runId, setRunId]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError]     = useState(null);

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
      } catch (err) {
        if (!cancelled) setError(err.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cameraId, appIdOverride]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await startAnalyticsApp(app.app_id, { camera_id: camera.camera_id, device });
      setRunId(res.run_id ?? res.runId ?? null);
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
      setRunId(null);
      toast.success(`${app.display_name} stopped`);
    } catch (err) {
      toast.error(`Failed to stop: ${err.message ?? err}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EEF2FA]">
        <Loader2 size={20} className="animate-spin text-[#0071C5]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#EEF2FA] p-6">
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[0.82rem] text-red-800 max-w-md">
          <AlertCircle size={15} className="mt-[1px] shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const deviceOptions = app.params_schema.properties?.device?.enum ?? [];
  const isRunning = !!runId;

  return (
    <div className="min-h-screen bg-[#EEF2FA] flex items-center justify-center p-6">
      <Toaster />
      <Card className="vms-card w-full max-w-md">
        <CardHeader className="vms-panel-hdr">
          <h2 className="vms-panel-title">
            <span className="vms-panel-icon"><Camera size={15} className="text-[#0071C5]" /></span>
            {camera.camera_name || camera.name || camera.camera_id}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-[#EDF0F9] mx-[22px] mb-[22px] border border-[#EDF0F9] overflow-hidden">
            <div className="vms-field-row bg-[#FAFBFF]">
              <span className="vms-field-label">Analytics App</span>
              <span className="vms-badge vms-badge-blue-dk">{app.display_name}</span>
            </div>

            <div className="vms-field-row items-start">
              <span className="vms-field-label pt-[3px]">Device</span>
              <RadioGroup
                value={device}
                onValueChange={setDevice}
                className="flex flex-row gap-[8px] flex-1 flex-wrap"
              >
                {deviceOptions.map((opt) => {
                  const isActive = device === opt;
                  return (
                    <Label key={opt} htmlFor={`cd-${opt}`}
                      className={`vms-radio-option ${isActive ? 'vms-radio-option-active' : ''}`}>
                      <RadioGroupItem id={`cd-${opt}`} value={opt} className="sr-only" disabled={isRunning} />
                      <span className={`vms-radio-dot ${isActive ? 'vms-radio-dot-active' : ''}`} />
                      <span className={`text-[0.83rem] font-semibold ${isActive ? 'text-[#0E1C47]' : 'text-[#4A5C80]'}`}>
                        {opt}
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>

            <div className="vms-field-row bg-[#F0F7FF]">
              <span className="vms-field-label">Pipeline</span>
              {isRunning ? (
                <Button size="sm" variant="destructive" className="text-[0.78rem] font-semibold px-4"
                  onClick={handleStop}>
                  <StopCircle size={13} className="mr-1.5" />Stop
                </Button>
              ) : (
                <Button size="sm" className="bg-[#0071C5] hover:bg-[#005BA0] text-white text-[0.78rem] font-semibold px-4"
                  onClick={handleStart} disabled={starting || !device}>
                  {starting
                    ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Starting…</>
                    : <><PlayCircle size={13} className="mr-1.5" />Start</>}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
