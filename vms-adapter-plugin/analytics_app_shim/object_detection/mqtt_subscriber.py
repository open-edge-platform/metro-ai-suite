# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MQTT subscriber for object detection inference metadata.

Subscribes to the MQTT broker and routes incoming DL Streamer inference
metadata to the appropriate VMS shim for analytics push.

Topic convention: ``{metadata_topic_prefix}/{vendor_prefix}:{camera_id}``
Example:         ``object_tracking/nx:abc123-device-uuid``

The prefix matches the LD app's OWN existing topic convention (see
loitering-detection's sample_start.sh: ``"${SOURCE_TOPIC_PREFIX:-object_tracking}/$x"``)
rather than a VMS-invented scheme, so the recipe's mqtt-table-flattener needs no
reconfiguration to also see VMS-driven streams.

On each message:
1. Parse vendor_prefix, camera_id from the trailing topic segment.
2. Look up the VMS shim by vendor_prefix.
3. Parse DLS metadata into a vendor-neutral ``DetectionFrame``.
4. Call ``vms_shim.publish_detections(camera_id, frame, context)``; the VMS
   shim renders the frame in its own format.

When ``events_enabled``, also subscribes to the app's own dedicated
status-event topic (e.g. published by the loitering-detection recipe's
mqtt-table-flattener sidecar once a track's dwell time exceeds its threshold):
``{metadata_topic_prefix}/{vendor_prefix}:{camera_id}/{event_topic_suffix}``.
Each row there becomes a vendor-neutral ``AnalyticsEvent`` published through
``vms_shim.publish_event`` (Nx: bookmark; Milestone: ANALYTICS_EVENT) — the
plugin never re-derives the app's own decision itself. The loiterer's latest
box, remembered from the metadata topic, is attached when known.
"""

from __future__ import annotations

import asyncio
import ssl
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import structlog

from plugin.base.interfaces import DetectionPublishContext
from plugin.common import camera_ref
from plugin.core.models.domain import AnalyticsEvent, DetectionObject

from .translator import parse_dls_frame

if TYPE_CHECKING:
    from plugin.core.factory import VmsShimSet

logger = structlog.get_logger(__name__)

# How long a track's last box stays usable for attaching to a loitering event.
_TRACK_BOX_TTL_S = 5.0


class MqttSubscriber:
    """Async MQTT subscriber that routes DLS inference metadata to VMS shims.

    Usage::

        subscriber = MqttSubscriber()
        task = asyncio.create_task(
            subscriber.run(mqtt_host, mqtt_port, vms_shim_sets)
        )
        # on shutdown:
        task.cancel()
    """

    def __init__(self) -> None:
        # camera_id -> {track_id: (latest box, monotonic time seen)}
        self._track_boxes: dict[str, dict[Any, tuple[DetectionObject, float]]] = {}

    def _remember_tracks(self, camera_id: str, objects: list[DetectionObject]) -> None:
        now = time.monotonic()
        tracks = self._track_boxes.setdefault(camera_id, {})
        for obj in objects:
            if obj.track_id is not None:
                tracks[obj.track_id] = (obj, now)
        for track_id in [t for t, (_, seen) in tracks.items() if now - seen > _TRACK_BOX_TTL_S]:
            del tracks[track_id]

    def _track_box(self, camera_id: str, track_id: Any) -> DetectionObject | None:
        tracks = self._track_boxes.get(camera_id, {})
        entry = tracks.get(track_id)
        if entry is None and isinstance(track_id, str) and track_id.isdigit():
            entry = tracks.get(int(track_id))
        if entry is None or time.monotonic() - entry[1] > _TRACK_BOX_TTL_S:
            return None
        return entry[0]

    async def run(
        self,
        mqtt_host: str,
        mqtt_port: int,
        vms_shim_sets: list[VmsShimSet],
        label_map: dict[str, str] | None = None,
        timestamp_offset_ms: int = 0,
        tls_context: ssl.SSLContext | None = None,
        zone_filter_enabled: bool = False,
        zones: dict[str, dict] | None = None,
        zone_type_id: str | None = None,
        metadata_topic_prefix: str = "object_tracking",
        events_enabled: bool = False,
        event_topic_suffix: str = "loiterstatus",
        app_id: str = "dls_vision",
    ) -> None:
        """Subscribe to MQTT and dispatch messages until cancelled.

        Topic wildcard: ``{metadata_topic_prefix}/+`` (matches
        ``{metadata_topic_prefix}/{vendor_prefix}:{camera_id}``).
        """
        try:
            import aiomqtt  # type: ignore[import]
        except ImportError:
            logger.error(
                "mqtt_subscriber_aiomqtt_missing",
                detail="Install aiomqtt: pip install aiomqtt",
            )
            return

        # Build a name → shim lookup for fast dispatch
        shim_map: dict[str, Any] = {ss.name: ss.vms_shim for ss in vms_shim_sets}

        publish_context = DetectionPublishContext(app_id=app_id, zone_type_id=zone_type_id)

        topic_filter = f"{metadata_topic_prefix}/+"
        event_topic_filter = f"{metadata_topic_prefix}/+/{event_topic_suffix}"

        logger.info(
            "mqtt_subscriber_starting",
            host=mqtt_host,
            port=mqtt_port,
            topic_filter=topic_filter,
            event_topic_filter=event_topic_filter if events_enabled else None,
        )

        while True:
            try:
                async with aiomqtt.Client(mqtt_host, port=mqtt_port, tls_context=tls_context) as client:
                    await client.subscribe(topic_filter)
                    if events_enabled:
                        await client.subscribe(event_topic_filter)
                    logger.info("mqtt_subscriber_subscribed", topic_filter=topic_filter)
                    async for message in client.messages:
                        topic = str(message.topic)
                        parts = topic.lstrip("/").split("/")
                        if events_enabled and len(parts) == 3 and parts[-1] == event_topic_suffix:  # noqa: PLR2004
                            await self._handle_status_event_message(
                                topic, message.payload, shim_map, publish_context,
                            )
                        else:
                            await self._handle_message(
                                topic,
                                message.payload,
                                shim_map,
                                label_map,
                                timestamp_offset_ms,
                                zone_filter_enabled,
                                zones,
                                zone_type_id,
                                publish_context,
                            )
            except asyncio.CancelledError:
                logger.info("mqtt_subscriber_stopped")
                return
            except Exception as exc:  # noqa: BLE001 — reconnect on any broker error
                logger.warning(
                    "mqtt_subscriber_disconnected",
                    error=str(exc),
                    retrying_in_seconds=5,
                )
                await asyncio.sleep(5)

    @staticmethod
    def _lookup_shim(shim_map: dict[str, Any], vms_name: str) -> Any | None:
        """Exact match first (e.g. "nx-main"), then prefix match (e.g. "nx" -> "nx-main")."""
        return shim_map.get(vms_name) or next(
            (v for k, v in shim_map.items() if k.startswith(vms_name)), None
        )

    async def _handle_message(
        self,
        topic: str,
        payload: bytes,
        shim_map: dict[str, Any],
        label_map: dict[str, str] | None = None,
        timestamp_offset_ms: int = 0,
        zone_filter_enabled: bool = False,
        zones: dict[str, dict] | None = None,
        zone_type_id: str | None = None,
        publish_context: DetectionPublishContext | None = None,
    ) -> None:
        """Parse topic, translate payload, and dispatch to VMS shim."""
        import json

        # "{prefix}/{vendor}:{camera_id}" -> 2 segments; trailing segment holds vendor:camera_id
        parts = topic.lstrip("/").split("/")
        if len(parts) != 2 or ":" not in parts[-1]:  # noqa: PLR2004
            logger.warning("mqtt_unexpected_topic_format", topic=topic)
            return

        vms_name, camera_id = camera_ref.decode(parts[-1]).split(":", 1)

        shim = self._lookup_shim(shim_map, vms_name)
        if shim is None:
            logger.warning(
                "mqtt_unknown_vms",
                vms_name=vms_name,
                known=list(shim_map.keys()),
            )
            return

        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("mqtt_payload_parse_failed", topic=topic, error=str(exc))
            return
        # accommodate DLS envelope {"metadata": {...}, "blob": ""} as well as just {},
        # as seen in DLS pipelines with appsink based destination vs gvametapublish based destination
        metadata = data.get("metadata", data)

        frame = parse_dls_frame(
            metadata,
            timestamp_offset_ms,
            zone_filter_enabled=zone_filter_enabled,
            zones=zones,
            label_map=label_map,
        )
        self._remember_tracks(f"{vms_name}:{camera_id}", frame.objects)
        if not frame.objects and not frame.zones:
            logger.debug("mqtt_no_objects_in_frame", topic=topic)
            return

        context = publish_context or DetectionPublishContext(app_id="dls_vision", zone_type_id=zone_type_id)
        ok = await shim.publish_detections(f"{vms_name}:{camera_id}", frame, context)
        if not ok:
            logger.warning(
                "mqtt_push_failed",
                vms_name=vms_name,
                camera_id=camera_id,
                objects_count=len(frame.objects),
            )
        else:
            logger.debug(
                "mqtt_pushed_objects",
                vms_name=vms_name,
                camera_id=camera_id,
                objects_count=len(frame.objects),
                timestamp_ms=frame.timestamp_ms,
            )

    async def _handle_status_event_message(
        self,
        topic: str,
        payload: bytes,
        shim_map: dict[str, Any],
        publish_context: DetectionPublishContext | None = None,
    ) -> None:
        """Publish every row on the app's own status-event topic as an analytics event.

        Pure pass-through: no dedup/cooldown/threshold logic here - the app
        already decided this event occurred (that's why the row exists at all),
        so every message received is published as-is. The VMS shim decides how
        to render it (Nx: bookmark; Milestone: ANALYTICS_EVENT).
        """
        import json

        # "{prefix}/{vendor}:{camera_id}/{suffix}" -> 3 segments; middle segment holds vendor:camera_id
        parts = topic.lstrip("/").split("/")
        if len(parts) != 3 or ":" not in parts[1]:  # noqa: PLR2004
            logger.warning("mqtt_unexpected_event_topic_format", topic=topic)
            return
        vms_name, device_id = camera_ref.decode(parts[1]).split(":", 1)

        shim = self._lookup_shim(shim_map, vms_name)
        if shim is None or not hasattr(shim, "publish_event"):
            return

        try:
            row = json.loads(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("mqtt_event_payload_parse_failed", topic=topic, error=str(exc))
            return
        if not isinstance(row, dict):
            return

        track_id = row.get("Track ID")
        if track_id is None:
            return

        label = row.get("Type") or "Object"
        zone = row.get("Zone")
        dwell = row.get("Dwell Time (s)")
        text = (
            f"{label} {track_id} loitering "
            f"{row.get('Dwell Time (s)', '?')}s in zone {row.get('Zone', '?')}"
        )
        try:
            dwell_s = float(dwell) if dwell is not None else None
        except (TypeError, ValueError):
            dwell_s = None
        camera_id = f"{vms_name}:{device_id}"
        box = self._track_box(camera_id, track_id)

        event = AnalyticsEvent(
            kind="loitering",
            text=text,
            timestamp=datetime.now(tz=timezone.utc),
            app_id=publish_context.app_id if publish_context else "dls_vision",
            label=str(label),
            track_id=track_id,
            zone=str(zone) if zone is not None else None,
            dwell_s=dwell_s,
            objects=[box] if box else [],
        )
        try:
            ok = await shim.publish_event(camera_id, event)
            logger.info(
                "loitering_event_published", camera_id=camera_id, track_id=track_id,
                result=ok, with_box=box is not None,
            )
        except Exception as exc:  # noqa: BLE001 — non-fatal, keep subscriber running
            logger.warning("loitering_event_failed", camera_id=camera_id, track_id=track_id, error=str(exc))
