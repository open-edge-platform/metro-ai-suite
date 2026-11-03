# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Neutral :class:`DetectionFrame` → Nx analytics object push payload.

Produces the object dicts expected by
``POST /rest/v4/analytics/engines/{engineId}/deviceAgents/{deviceId}/metadata/object``.
"""

from __future__ import annotations

import uuid
from typing import Any

from plugin.core.models.domain import DetectionFrame

TYPE_DEFAULT = "python.detected.object"
ZONE_CATEGORY = "zone"
DEFAULT_ZONE_TYPE_ID = "vap.zone"


def category_to_type_id(category: str, type_map: dict[str, str] | None = None) -> str:
    """Resolve a neutral category to an Nx typeId.

    Precedence: explicit ``type_map`` override, then a category that already
    looks like a typeId (contains ``.``, e.g. legacy ``vap.vehicle`` values),
    then ``vap.<category>``.
    """
    if type_map and category in type_map:
        return type_map[category]
    if "." in category:
        return category
    return f"vap.{category}"


def _bounding_box(x_min: float, y_min: float, x_max: float, y_max: float) -> str:
    """Nx bounding box format: ``x,y,widthxheight`` (all normalized 0-1)."""
    width = max(0.0, x_max - x_min)
    height = max(0.0, y_max - y_min)
    return f"{x_min:.4f},{y_min:.4f},{width:.4f}x{height:.4f}"


def frame_to_nx(
    frame: DetectionFrame,
    type_map: dict[str, str] | None = None,
    zone_type_id: str = DEFAULT_ZONE_TYPE_ID,
) -> list[dict[str, Any]]:
    """Convert a neutral frame to Nx object dicts.

    Each object's neutral category resolves to a typeId through
    :func:`category_to_type_id`; uncategorized objects use ``python.detected.object``. Objects without a track id get
    a random UUID. Each zone becomes a persistent marker box with a stable
    per-zone trackId so Nx keeps one box across pushes.
    """
    nx_objects: list[dict[str, Any]] = []

    for obj in frame.objects:
        # Prefer the gvatrack id; fall back to the older region_id seed, then random.
        seed = obj.track_id if obj.track_id is not None else obj.region_id
        track_id = str(uuid.UUID(int=seed)) if seed is not None else str(uuid.uuid4())
        attributes = [
            {"type": "String", "name": "label", "value": obj.label, "confidence": obj.confidence},
        ]
        if obj.track_id is not None:
            attributes.append(
                {"type": "String", "name": "id", "value": str(obj.track_id), "confidence": obj.confidence}
            )
        if obj.dwell_s is not None:
            attributes.append(
                {"type": "String", "name": "zone_id", "value": ",".join(obj.zone_ids), "confidence": obj.confidence}
            )
            attributes.append(
                {"type": "String", "name": "dwell_time_sec", "value": f"{obj.dwell_s:.1f}", "confidence": obj.confidence}
            )
        nx_objects.append(
            {
                "trackId": track_id,
                "typeId": category_to_type_id(obj.category, type_map) if obj.category else TYPE_DEFAULT,
                "boundingBox": _bounding_box(obj.x_min, obj.y_min, obj.x_max, obj.y_max),
                "confidence": obj.confidence,
                "attributes": attributes,
            }
        )

    for zone in frame.zones:
        nx_objects.append(
            {
                "trackId": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"vap-zone:{zone.zone_id}")),
                "typeId": zone_type_id,
                "boundingBox": _bounding_box(zone.x_min, zone.y_min, zone.x_max, zone.y_max),
                "confidence": 1.0,
                "attributes": [
                    {"type": "String", "name": "label", "value": zone.label, "confidence": 1.0},
                ],
            }
        )
    return nx_objects
