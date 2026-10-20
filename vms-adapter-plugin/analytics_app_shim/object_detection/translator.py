# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""DL Streamer metadata → Nx analytics object push payload translator.

Converts the inference metadata published by DL Streamer Pipeline Server
to MQTT into the list of Nx object-push dicts expected by
``POST /rest/v4/analytics/engines/{engineId}/deviceAgents/{deviceId}/metadata/object``.

Sample DLS payload shape (see sample_app_metadata.json):
{
  "objects": [
    {
      "detection": {
        "bounding_box": {"x_min": 0.87, "x_max": 0.99, "y_min": 0.16, "y_max": 0.31},
        "confidence": 0.745,
        "label": "car",
        "label_id": 2
      },
      "id": 1,
      "region_id": 1,
      "roi_type": "car",
      "dwell_times": [{"zone_id": "region1", "dwell_time_sec": 3.1, "first_seen_timestamp_sec": 0.0}],
      "zone_violations": ["region1"],
      ...
    }
  ],
  "rtp": {"sender_ntp_unix_timestamp_ns": 1777350580751188754},
  "timestamp": 66611537331
}

``dwell_times``/``zone_violations`` are emitted by newer pipelines that use the
``gvaanalytics`` element (zone/tripwire dwell-time analytics) instead of the
older ``gvaattachroi`` ROI-crop + fake-artifact-object approach: detection now
runs full-frame, and zone membership/dwell time is computed natively per
object instead of being inferred here from a fake ROI object.
"""

from __future__ import annotations

import time
import uuid
from typing import Any


_TYPE_DEFAULT = "python.detected.object"


def _label_to_type_id(label: str, label_type_map: dict[str, str]) -> str:
    """Resolve a detection label to a registered Nx typeId.

    Looks up ``label`` (case-insensitively) in ``label_type_map``.
    Falls back to ``python.detected.object`` for unrecognised labels.
    """
    return label_type_map.get(label.lower(), _TYPE_DEFAULT)


def _zone_marker_objects(
    zones: dict[str, dict[str, Any]] | None,
    zone_type_id: str,
) -> list[dict[str, Any]]:
    """Build persistent Nx-push objects that draw each configured zone as a box.

    Newer DLStreamer pipelines compute zones via ``gvaanalytics`` (zone id +
    polygon live only in the pipeline server's own zone config file) instead of
    the old ``gvaattachroi`` fake detection object, so there is nothing left in
    the MQTT metadata to visualize the zone region. These marker objects stand
    in for that, using a stable per-zone trackId so Nx keeps the same box
    (rather than spawning a new track) across pushes.
    """
    markers: list[dict[str, Any]] = []
    for zone_id, zone_cfg in (zones or {}).items():
        x_min, y_min, x_max, y_max = zone_cfg["bounding_box"]
        width = max(0.0, x_max - x_min)
        height = max(0.0, y_max - y_min)
        label = zone_cfg.get("label") or f"Zone {zone_id}"
        track_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"vap-zone:{zone_id}"))
        markers.append(
            {
                "trackId": track_id,
                "typeId": zone_type_id,
                "boundingBox": f"{x_min:.4f},{y_min:.4f},{width:.4f}x{height:.4f}",
                "confidence": 1.0,
                "attributes": [
                    {"type": "String", "name": "label", "value": label, "confidence": 1.0},
                ],
            }
        )
    return markers


def translate_dls_metadata(
    payload: dict[str, Any],
    label_type_map: dict[str, str] | None = None,
    timestamp_offset_ms: int = 0,
    zone_filter_enabled: bool = False,
    zones: dict[str, dict[str, Any]] | None = None,
    zone_type_id: str = "vap.zone",
) -> tuple[list[dict[str, Any]], int]:
    """Convert a DL Streamer inference metadata payload to Nx push format.

    Args:
        payload: Raw DL Streamer MQTT metadata dict.
        label_type_map: Optional mapping of detection label (lower-cased) to Nx
            typeId.  Labels absent from the map resolve to
            ``python.detected.object``.  Typically comes from
            ``ObjectDetectionAnalyticsAppConfig.label_type_map``.
        timestamp_offset_ms: Milliseconds added to the computed timestamp before
            pushing.  Use a negative value (e.g. ``-300``) to compensate for
            inference pipeline latency and align metadata with the video frame
            in Nx.  Configured via
            ``ObjectDetectionAnalyticsAppConfig.metadata_timestamp_offset_ms``.
        zone_filter_enabled: When True, drop objects that aren't currently
            inside a monitored zone (no ``zone_violations``/``dwell_times``
            entry). Pipelines built around ``gvaanalytics`` run detection
            full-frame, so without this the Nx overlay shows every detected
            object instead of only the ones inside the loitering zone.
        zones: Static zone geometry (id -> {bounding_box, label}) drawn as a
            persistent marker box per zone, since nothing in the per-frame
            metadata carries zone geometry anymore.
        zone_type_id: Nx typeId used for the pushed zone marker box(es).

    Returns a tuple of:
    - list of Nx object dicts (may be empty if no valid detections and no
      configured zones)
    - timestamp_ms to use for the metadata push

    The timestamp is taken from ``rtp.sender_ntp_unix_timestamp_ns`` (converted
    to milliseconds) when present, so the metadata aligns with the video frame
    in Nx.  Falls back to local wall-clock time when the field is absent.
    ``timestamp_offset_ms`` is applied in both cases.

    The ``typeId`` of each object is resolved from the detection label via
    ``label_type_map``, falling back to ``python.detected.object`` for
    unrecognised labels.
    """
    _map = {k.lower(): v for k, v in (label_type_map or {}).items()}
    rtp = payload.get("rtp") or {}
    ntp_ns = rtp.get("sender_ntp_unix_timestamp_ns", 0)
    timestamp_ms = (ntp_ns // 1_000_000 if ntp_ns else int(time.time() * 1000)) + timestamp_offset_ms

    objects: list[dict[str, Any]] = []
    for obj in payload.get("objects", []):
        detection = obj.get("detection") or {}
        bbox = detection.get("bounding_box") or {}

        x_min = bbox.get("x_min")
        y_min = bbox.get("y_min")
        x_max = bbox.get("x_max")
        y_max = bbox.get("y_max")
        if None in (x_min, y_min, x_max, y_max):
            continue

        dwell_times = obj.get("dwell_times") or []
        zone_ids = obj.get("zone_violations") or [
            d.get("zone_id") for d in dwell_times if d.get("zone_id")
        ]
        zone_ids = sorted({z for z in zone_ids if z})

        if zone_filter_enabled and not zone_ids:
            continue

        width = max(0.0, x_max - x_min)
        height = max(0.0, y_max - y_min)
        # Nx bounding box format: "x,y,widthxheight" (all normalized 0–1)
        bounding_box = f"{x_min:.4f},{y_min:.4f},{width:.4f}x{height:.4f}"

        confidence = float(detection.get("confidence", 0.0))
        label = detection.get("label") or obj.get("roi_type") or "unknown"

        # Prefer the gvatrack-assigned stable "id"; fall back to the older
        # region_id seed, then a random UUID when neither is present.
        obj_id = obj.get("id")
        region_id = obj.get("region_id")
        if obj_id is not None:
            track_id = str(uuid.UUID(int=int(obj_id)))
        elif region_id:
            track_id = str(uuid.UUID(int=region_id))
        else:
            track_id = str(uuid.uuid4())

        type_id = _label_to_type_id(label, _map)

        attributes = [
            {"type": "String", "name": "label", "value": label, "confidence": confidence},
        ]
        if dwell_times:
            # Pure pass-through of the pipeline's own dwell computation - whether this
            # counts as "loitering" is decided upstream (gvaanalytics/loitering_watermark
            # threshold); not re-derived here to avoid duplicating that logic.
            max_dwell = max(d.get("dwell_time_sec", 0.0) for d in dwell_times)
            attributes.append(
                {"type": "String", "name": "zone_id", "value": ",".join(zone_ids), "confidence": confidence}
            )
            attributes.append(
                {"type": "String", "name": "dwell_time_sec", "value": f"{max_dwell:.1f}", "confidence": confidence}
            )

        objects.append(
            {
                "trackId": track_id,
                "typeId": type_id,
                "boundingBox": bounding_box,
                "confidence": confidence,
                "attributes": attributes,
            }
        )

    objects.extend(_zone_marker_objects(zones, zone_type_id))

    return objects, timestamp_ms
