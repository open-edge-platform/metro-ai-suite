# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""DL Streamer inference metadata → vendor-neutral :class:`DetectionFrame`.

This is the only place the DL Streamer MQTT payload is parsed. VMS shims turn
the resulting frame into their own wire format (Nx JSON, ONVIF XML, ...).

Sample DLS payload shape (see sample_app_metadata.json):
{
  "objects": [
    {
      "detection": {
        "bounding_box": {"x_min": 0.1, "y_min": 0.2, "x_max": 0.3, "y_max": 0.4},
        "confidence": 0.87,
        "label": "pedestrian"
      },
      "id": 4,
      "zone_violations": ["region1"],
      "dwell_times": [{"zone_id": "region1", "dwell_time_sec": 3.2}]
    }
  ],
  "rtp": {"sender_ntp_unix_timestamp_ns": 1777350580751188754},
  "timestamp": 66611537331
}

``dwell_times``/``zone_violations`` are emitted by pipelines that use the
``gvaanalytics`` element (zone/tripwire dwell-time analytics): detection runs
full-frame, and zone membership/dwell time is computed per object.
"""

from __future__ import annotations

import time
from typing import Any

from plugin.core.models.domain import DetectionFrame, DetectionObject, DetectionZone


def parse_dls_frame(
    payload: dict[str, Any],
    timestamp_offset_ms: int = 0,
    zone_filter_enabled: bool = False,
    zones: dict[str, dict[str, Any]] | None = None,
    label_map: dict[str, str] | None = None,
) -> DetectionFrame:
    """Parse a DL Streamer metadata payload into a neutral frame.

    Args:
        payload: Raw DL Streamer MQTT metadata dict (envelope already unwrapped).
        timestamp_offset_ms: Added to the frame timestamp to compensate for
            inference latency (negative values move metadata earlier).
        zone_filter_enabled: Drop objects not currently inside a monitored zone
            (no ``zone_violations``/``dwell_times`` entry).
        label_map: Detection label (case-insensitive) -> neutral category.
        zones: Static zone geometry (id -> {bounding_box, label}); carried on
            the frame because per-frame metadata no longer includes it.

    The timestamp comes from ``rtp.sender_ntp_unix_timestamp_ns`` when present
    so metadata aligns with the video frame, else local wall-clock time.
    Objects missing any bounding-box edge are skipped.
    """
    categories = {k.lower(): v for k, v in (label_map or {}).items()}
    rtp = payload.get("rtp") or {}
    ntp_ns = rtp.get("sender_ntp_unix_timestamp_ns", 0)
    timestamp_ms = (ntp_ns // 1_000_000 if ntp_ns else int(time.time() * 1000)) + timestamp_offset_ms

    objects: list[DetectionObject] = []
    for obj in payload.get("objects", []):
        detection = obj.get("detection") or {}
        bbox = detection.get("bounding_box") or {}
        edges = (bbox.get("x_min"), bbox.get("y_min"), bbox.get("x_max"), bbox.get("y_max"))
        if None in edges:
            continue

        dwell_times = obj.get("dwell_times") or []
        zone_ids = obj.get("zone_violations") or [
            d.get("zone_id") for d in dwell_times if d.get("zone_id")
        ]
        zone_ids = sorted({z for z in zone_ids if z})
        if zone_filter_enabled and not zone_ids:
            continue

        track_id = obj.get("id")
        region_id = obj.get("region_id") or None

        # Dwell is passed through from the pipeline; whether it counts as
        # "loitering" is decided upstream, not re-derived here.
        dwell_s = max(d.get("dwell_time_sec", 0.0) for d in dwell_times) if dwell_times else None

        label = detection.get("label") or obj.get("roi_type") or "unknown"
        objects.append(
            DetectionObject(
                track_id=int(track_id) if track_id is not None else None,
                region_id=int(region_id) if region_id is not None else None,
                label=label,
                category=categories.get(label.lower()),
                confidence=float(detection.get("confidence", 0.0)),
                x_min=edges[0],
                y_min=edges[1],
                x_max=edges[2],
                y_max=edges[3],
                zone_ids=zone_ids,
                dwell_s=dwell_s,
            )
        )

    zone_models = [
        DetectionZone(
            zone_id=str(zone_id),
            label=zone_cfg.get("label") or f"Zone {zone_id}",
            x_min=zone_cfg["bounding_box"][0],
            y_min=zone_cfg["bounding_box"][1],
            x_max=zone_cfg["bounding_box"][2],
            y_max=zone_cfg["bounding_box"][3],
        )
        for zone_id, zone_cfg in (zones or {}).items()
    ]
    return DetectionFrame(timestamp_ms=timestamp_ms, objects=objects, zones=zone_models)
