// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Detects whether the current URL is a camera-specific embed link (opened
 * from inside a VMS, e.g. Milestone Management Client or an Nx Web Page),
 * and if so extracts the target camera_id (and an optional app_id override).
 *
 * Two shapes are recognised:
 *
 *   1. Explicit:          /camera?camera_id=<id>&app_id=<id>
 *      Any VMS where we control the registered URL (e.g. Nx Web Pages).
 *
 *   2. Milestone-derived: /{deviceId}[/{otherId}]/{streamId}
 *      Management Client appends its own GUIDs to our registered
 *      dashboard_url and drops any query string — see
 *      milestone-derived-url-investigation.txt. Confirmed against a live
 *      AI Bridge discovery response: the composite camera_id is built from
 *      the FIRST and LAST GUID segments (`milestone:{deviceId}/{streamId}`);
 *      a middle segment, when present, is some other Milestone-internal id
 *      (not part of the stream's composite id) and is ignored.
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEmbedRoute(location = window.location) {
  const params = new URLSearchParams(location.search);
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments[0] === 'camera') {
    const cameraId = params.get('camera_id');
    return cameraId ? { cameraId, appId: params.get('app_id') || null } : null;
  }

  if (segments.length >= 2 && segments.length <= 3 && segments.every((s) => GUID_RE.test(s))) {
    const deviceId = segments[0];
    const streamId = segments[segments.length - 1];
    return { cameraId: `milestone:${deviceId}/${streamId}`, appId: params.get('app_id') || null };
  }

  return null;
}
