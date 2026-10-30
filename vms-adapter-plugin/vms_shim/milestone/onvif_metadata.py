# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Detection metadata → ONVIF analytics XML for Milestone AI Bridge.

Translates the vendor-neutral detection frame built from DL Streamer Pipeline
Server into the two ONVIF payloads AI Bridge accepts on a *metadata topic*:

* :func:`build_frame_xml`            → ``ONVIF_ANALYTICS_FRAME`` (a bare
  ``tt:Frame``; VAP's default, mapped from ``object_detection`` apps)
* :func:`build_metadata_stream_xml`  → ``ONVIF_ANALYTICS`` (a full
  ``tt:MetadataStream`` wrapper)

Both are POSTed as ``Content-Type: text/xml`` to the sink resolved from
``metadataTopics { topicAvailability { rest } }``. XProtect renders the boxes in
Smart Client and indexes them for Metadata Search.

Coordinate systems
------------------
This is the subtle part, and the most likely source of "boxes appear mirrored"
bugs. VAP and DL Streamer use **normalized image coordinates** — ``0..1`` with
the origin at the *top*-left and ``y`` increasing *downwards*. ONVIF uses
``-1..+1`` with the origin at the *centre* and ``y`` increasing **upwards**::

    image (0..1, y down)          ONVIF (-1..+1, y up)
    (0,0) ┌─────────┐             (-1,+1) ┌─────────┐ (+1,+1)
          │         │                     │　 (0,0) │
          └─────────┘ (1,1)       (-1,-1) └─────────┘ (+1,-1)

so the ``y`` axis is **inverted**, not merely rescaled:

* ``left   = 2·x_min − 1``     * ``top    = 1 − 2·y_min``
* ``right  = 2·x_max − 1``     * ``bottom = 1 − 2·y_max``

Verified against Milestone's own ``onvif-frame1.xml`` sample, whose "top left
rectangle" is ``left="-1" right="-0.5" top="1" bottom="0.5"`` — i.e. image-space
``(0,0)..(0.25,0.25)``. See :func:`to_onvif_bbox`.

Serialisation
-------------
Built as strings rather than via ``ElementTree`` so the output matches
Milestone's templates byte-for-byte — notably, the ``ONVIF_ANALYTICS_FRAME``
root carries **no** ``xmlns:tt`` declaration while ``ONVIF_ANALYTICS`` does.
All interpolated values pass through :mod:`xml.sax.saxutils`, so labels
containing ``&`` or ``"`` cannot corrupt the document.

Reference: ``milestonesys/MIP-AIBridge-samples`` →
``apps/golang/connectivitysample/src/application/services/templates/``
"""

from __future__ import annotations

import time
import zlib
from datetime import datetime, timezone
from typing import Any, Iterable
from xml.sax.saxutils import escape, quoteattr

from plugin.core.models.domain import DetectionFrame

ONVIF_NS = "http://www.onvif.org/ver10/schema"

# Milestone renders these as the box fill/outline in Smart Client. ARGB hex.
DEFAULT_FILL_COLOR = "#3000a3e0"
DEFAULT_LINE_COLOR = "#ff00a3e0"
DEFAULT_LINE_THICKNESS_PX = 2
# Box colors are assigned per class from this palette (RGB). The index layout
# gives the common classes distinct colors: Human blue, Vehicle red, zone amber.
CLASS_PALETTE = (
    "8e24aa", "00a3e0", "43a047", "ffa000", "d81b60", "00bcd4",
    "c0ca33", "f4511e", "5c6bc0", "fdd835", "e53935", "00897b",
)
# Color key for static zones, which carry no ONVIF class.
ZONE_COLOR_KEY = "zone"
_FILL_ALPHA = "30"
# Zone ObjectIds sit above any realistic tracker id so they never collide.
_ZONE_OBJECT_ID_BASE = 2_000_000_000


def rfc3339_nano(timestamp_ms: int | None = None) -> str:
    """Format a UTC timestamp the way AI Bridge expects (Go ``RFC3339Nano``).

    Args:
        timestamp_ms: Unix epoch milliseconds; current time when ``None``.
    """
    ms = int(time.time() * 1000) if timestamp_ms is None else int(timestamp_ms)
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    # Go's RFC3339Nano trims trailing zeros; Python pads to 6 digits. Both parse.
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _clamp01(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


def to_onvif_bbox(
    x_min: float, y_min: float, x_max: float, y_max: float,
) -> dict[str, float]:
    """Convert a normalized ``0..1`` image box to ONVIF ``-1..+1`` coordinates.

    Inputs are clamped to ``0..1`` first: DL Streamer occasionally emits boxes
    fractionally outside the frame, and XProtect rejects out-of-range values.
    The ``y`` axis is inverted — see the module docstring.

    Returns a dict with ``left``, ``top``, ``right``, ``bottom``.
    """
    x0, x1 = sorted((_clamp01(x_min), _clamp01(x_max)))
    y0, y1 = sorted((_clamp01(y_min), _clamp01(y_max)))
    return {
        "left": 2.0 * x0 - 1.0,
        "right": 2.0 * x1 - 1.0,
        "top": 1.0 - 2.0 * y0,
        "bottom": 1.0 - 2.0 * y1,
    }


def _attr(name: str, value: Any) -> str:
    """Render one XML attribute with proper quoting/escaping."""
    return f"{name}={quoteattr(str(value))}"


def _num(value: float) -> str:
    """Render a coordinate, trimming float noise (e.g. 0.30000000000000004)."""
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


# Label font size, in ONVIF units of frame height.
_LABEL_SIZE = 0.05
# Rough rendered width of one label character, in ONVIF x units per unit of
# size (a bold sans glyph is ~0.6 of its height, on a 16:9 frame).
_LABEL_CHAR_WIDTH = 0.6 * 9 / 16
# Keeps labels a little clear of the frame edges.
_LABEL_MARGIN = 0.01


def _label_position(box: dict[str, float], text: str) -> tuple[float, float]:
    """Where to anchor a box's label so Smart Client shows it whole.

    Smart Client centres ``Description`` text on its ``x`` (Milestone's sample
    puts a box's label at the box's horizontal centre), so the label is centred
    over the box and then shifted, by its estimated width, to stay inside the
    frame. It sits just above the box, or just below when the box touches the
    top edge.
    """
    half_width = len(text) * _LABEL_SIZE * _LABEL_CHAR_WIDTH / 2 + _LABEL_MARGIN
    centre = (box["left"] + box["right"]) / 2
    if half_width >= 1:
        x = 0.0
    else:
        x = min(max(centre, -1 + half_width), 1 - half_width)
    above = box["top"] + 0.04
    y = above if above <= 1 - _LABEL_SIZE else max(-1.0, box["bottom"] - _LABEL_MARGIN)
    return x, y


def _object_xml(obj: dict[str, Any], indent: str = "    ") -> str:
    """Render a single ``tt:Object`` element.

    ``obj`` is a normalized detection dict as produced by
    :func:`frame_to_detections`.
    """
    box = obj["bbox"]
    pad = indent
    lines = [
        f"{pad}<tt:Object {_attr('ObjectId', obj['object_id'])}>",
        f"{pad}    <tt:Appearance>",
    ]

    label = obj.get("label")
    if label:
        lines += [
            f"{pad}        <tt:Class>",
            f"{pad}            <tt:ClassCandidate>",
            f"{pad}                <tt:Type>{escape(str(label))}</tt:Type>",
            f"{pad}                <tt:Likelihood>"
            f"{_num(obj.get('confidence', 0.0))}</tt:Likelihood>",
            f"{pad}            </tt:ClassCandidate>",
            f"{pad}        </tt:Class>",
        ]

    lines += [
        f"{pad}        <tt:Shape>",
        f"{pad}            <tt:BoundingBox "
        f"{_attr('left', _num(box['left']))} "
        f"{_attr('top', _num(box['top']))} "
        f"{_attr('right', _num(box['right']))} "
        f"{_attr('bottom', _num(box['bottom']))}/>",
        f"{pad}            <tt:Extension>",
        f"{pad}                <BoundingBoxAppearance>",
        f"{pad}                    <Fill {_attr('color', obj.get('fill_color', DEFAULT_FILL_COLOR))} />",
        f"{pad}                    <Line {_attr('color', obj.get('line_color', DEFAULT_LINE_COLOR))} "
        f"{_attr('displayedThicknessInPixels', DEFAULT_LINE_THICKNESS_PX)} />",
        f"{pad}                </BoundingBoxAppearance>",
        f"{pad}            </tt:Extension>",
        f"{pad}        </tt:Shape>",
    ]

    description = obj.get("description")
    if description:
        text_x, text_y = _label_position(box, str(description))
        lines += [
            f"{pad}        <tt:Extension>",
            f"{pad}            <Description "
            f"{_attr('x', _num(text_x))} {_attr('y', _num(text_y))} "
            f"{_attr('size', _num(_LABEL_SIZE))} {_attr('bold', 'true')} "
            f"{_attr('italic', 'false')} {_attr('fontFamily', 'Helvetica')} "
            f"{_attr('color', obj.get('line_color', DEFAULT_LINE_COLOR))}>"
            f"{escape(str(description))}</Description>",
            f"{pad}        </tt:Extension>",
        ]

    lines += [
        f"{pad}    </tt:Appearance>",
        f"{pad}</tt:Object>",
    ]
    return "\n".join(lines)


def build_frame_xml(
    objects: Iterable[dict[str, Any]],
    source_stream_id: str,
    timestamp_ms: int | None = None,
) -> str:
    """Build an ``ONVIF_ANALYTICS_FRAME`` payload (bare ``tt:Frame``).

    Args:
        objects: Normalized detections from :func:`frame_to_detections`.
        source_stream_id: AI Bridge composite ``"{deviceId}/{streamId}"``.
        timestamp_ms: Frame wall-clock time in epoch ms; now when ``None``.

    An empty ``objects`` iterable produces a valid empty frame, which is how a
    detector signals "nothing in view" and clears stale boxes in Smart Client.
    """
    body = "\n".join(_object_xml(o) for o in objects)
    head = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<tt:Frame {_attr('UtcTime', rfc3339_nano(timestamp_ms))} "
        f"{_attr('SourceStreamID', source_stream_id)}>"
    )
    return f"{head}\n{body}\n</tt:Frame>" if body else f"{head}\n</tt:Frame>"


def build_metadata_stream_xml(
    objects: Iterable[dict[str, Any]],
    source_stream_id: str,
    timestamp_ms: int | None = None,
) -> str:
    """Build an ``ONVIF_ANALYTICS`` payload (full ``tt:MetadataStream``).

    Same content as :func:`build_frame_xml`, wrapped in the
    ``MetadataStream``/``VideoAnalytics`` envelope and carrying the ``tt``
    namespace declaration.
    """
    body = "\n".join(_object_xml(o, indent="            ") for o in objects)
    frame_open = (
        f"        <tt:Frame {_attr('UtcTime', rfc3339_nano(timestamp_ms))} "
        f"{_attr('SourceStreamID', source_stream_id)}>"
    )
    inner = f"{frame_open}\n{body}\n        </tt:Frame>" if body else (
        f"{frame_open}\n        </tt:Frame>"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<tt:MetadataStream xmlns:tt="{ONVIF_NS}">\n'
        "    <tt:VideoAnalytics>\n"
        f"{inner}\n"
        "    </tt:VideoAnalytics>\n"
        "</tt:MetadataStream>"
    )


# Neutral category → ONVIF class. Matching Smart Client's Metadata Search
# People/Vehicles filters requires Human/Vehicle.
DEFAULT_CLASS_MAP = {
    "person": "Human",
    "pedestrian": "Human",
    "human": "Human",
    "vehicle": "Vehicle",
}


def category_to_class(
    category: str | None, label: str, class_map: dict[str, str] | None = None,
) -> str:
    """Resolve an object's ONVIF class; unmapped objects keep their label.

    The last dotted part of ``category`` is used, so legacy typeId-style values
    (``vap.vehicle``) resolve like ``vehicle``.
    """
    if not category:
        return label
    key = category.rsplit(".", 1)[-1].lower()
    return (class_map or {}).get(key) or DEFAULT_CLASS_MAP.get(key) or label


class ClassColors:
    """Assigns each class a color from :data:`CLASS_PALETTE`, automatically.

    A class starts at a slot derived from its name, so a given class gets the
    same color across restarts; if that slot is already taken by another class,
    the next free slot is used. Distinct classes get distinct colors until the
    palette is exhausted, after which colors are reused.
    """

    def __init__(self) -> None:
        self._slots: dict[str, int] = {}

    def colors(self, key: str) -> tuple[str, str]:
        """Return ``(line, fill)`` ``#AARRGGBB`` colors for a class."""
        key = (key or "").strip().lower()
        slot = self._slots.get(key)
        if slot is None:
            start = zlib.crc32(key.encode("utf-8")) % len(CLASS_PALETTE)
            taken = set(self._slots.values())
            slot = next(
                (s % len(CLASS_PALETTE) for s in range(start, start + len(CLASS_PALETTE))
                 if s % len(CLASS_PALETTE) not in taken),
                start,
            )
            self._slots[key] = slot
        rgb = CLASS_PALETTE[slot]
        return f"#ff{rgb}", f"#{_FILL_ALPHA}{rgb}"


def _zone_object_id(zone_id: str) -> int:
    """Stable integer ObjectId for a zone, so Smart Client keeps one box per zone."""
    return _ZONE_OBJECT_ID_BASE + zlib.crc32(zone_id.encode("utf-8")) % 100_000_000


def frame_to_detections(
    frame: DetectionFrame,
    label_class_map: dict[str, str] | None = None,
    show_labels: bool = True,
    colors: ClassColors | None = None,
) -> list[dict[str, Any]]:
    """Convert a neutral frame into renderable ONVIF-space detection dicts.

    Args:
        frame: Neutral frame produced by an app shim.
        label_class_map: Optional neutral category → ONVIF class overrides
            (``vendor_options.class_map``), on top of :data:`DEFAULT_CLASS_MAP`.
        show_labels: Render the label/confidence as on-screen text.
        colors: Per-class color assignment; keep one per shim so classes keep
            their colors. A fresh one is used when omitted.

    Each object is colored by its ONVIF class. The frame's static zones are
    rendered too, as unclassified boxes with their label (so Metadata Search
    does not count them as objects), colored as the ``zone`` class.
    """
    class_map = {k.lower(): v for k, v in (label_class_map or {}).items()}
    colors = colors or ClassColors()

    detections: list[dict[str, Any]] = []
    for index, obj in enumerate(frame.objects, start=1):
        description = ""
        if show_labels and obj.label:
            description = (
                f"{obj.label} {obj.confidence:.0%}" if obj.confidence else obj.label
            )
        onvif_class = category_to_class(obj.category, obj.label, class_map)
        line, fill = colors.colors(onvif_class)
        detections.append({
            # ONVIF ObjectId must be an integer; fall back to the frame ordinal
            # when the pipeline does not track.
            "object_id": obj.track_id or obj.region_id or index,
            "label": onvif_class,
            "confidence": obj.confidence,
            "description": description,
            "bbox": to_onvif_bbox(obj.x_min, obj.y_min, obj.x_max, obj.y_max),
            "line_color": line,
            "fill_color": fill,
        })

    for zone in frame.zones:
        line, fill = colors.colors(ZONE_COLOR_KEY)
        detections.append({
            "object_id": _zone_object_id(zone.zone_id),
            "label": None,
            "description": zone.label if show_labels else "",
            "bbox": to_onvif_bbox(zone.x_min, zone.y_min, zone.x_max, zone.y_max),
            "line_color": line,
            "fill_color": fill,
        })
    return detections


def frame_to_onvif(
    frame: DetectionFrame,
    source_stream_id: str,
    metadata_format: str = "ONVIF_ANALYTICS_FRAME",
    label_class_map: dict[str, str] | None = None,
    colors: ClassColors | None = None,
) -> str:
    """Neutral frame → ONVIF XML for the configured format.

    Args:
        frame: Neutral frame; its timestamp already includes any latency offset.
        source_stream_id: AI Bridge composite ``"{deviceId}/{streamId}"``.
        metadata_format: ``ONVIF_ANALYTICS_FRAME`` or ``ONVIF_ANALYTICS``;
            must match what was registered for the topic.
        label_class_map: Detection label → ONVIF class name.
        colors: Per-class color assignment (see :class:`ClassColors`).

    Raises:
        ValueError: if ``metadata_format`` is not an ONVIF format.
    """
    detections = frame_to_detections(frame, label_class_map, colors=colors)

    if metadata_format == "ONVIF_ANALYTICS_FRAME":
        return build_frame_xml(detections, source_stream_id, frame.timestamp_ms)
    if metadata_format == "ONVIF_ANALYTICS":
        return build_metadata_stream_xml(detections, source_stream_id, frame.timestamp_ms)
    raise ValueError(
        f"metadata_format '{metadata_format}' is not an ONVIF format; "
        "expected ONVIF_ANALYTICS_FRAME or ONVIF_ANALYTICS",
    )
