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
3. Translate DLS metadata to Nx object-push format.
4. Call ``vms_shim.push_analytics_objects(device_id, objects, timestamp_ms)``.

When ``loiter_bookmark_enabled``, also subscribes to the loitering-detection
recipe's own threshold-crossing topic (published by its mqtt-table-flattener
sidecar once a track's dwell time exceeds the threshold configured INSIDE that
app): ``{metadata_topic_prefix}/{vendor_prefix}:{camera_id}/{loiter_status_topic_suffix}``.
Each row there is pushed as an Nx bookmark — the plugin never re-derives
"is this object loitering" itself.
"""

from __future__ import annotations

import asyncio
import ssl
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

import structlog

from .translator import translate_dls_metadata

if TYPE_CHECKING:
    from plugin.core.factory import VmsShimSet

logger = structlog.get_logger(__name__)

# Cap on the (camera, track) bookmark-dedup cache before opportunistically
# pruning stale entries, so long-running deployments with high track churn
# don't grow it unboundedly.
_NOTIFIED_CACHE_PRUNE_THRESHOLD = 500


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

    async def run(
        self,
        mqtt_host: str,
        mqtt_port: int,
        vms_shim_sets: list[VmsShimSet],
        label_type_map: dict[str, str] | None = None,
        timestamp_offset_ms: int = 0,
        tls_context: ssl.SSLContext | None = None,
        zone_filter_enabled: bool = False,
        zones: dict[str, dict] | None = None,
        zone_type_id: str = "vap.zone",
        metadata_topic_prefix: str = "object_tracking",
        loiter_bookmark_enabled: bool = False,
        loiter_status_topic_suffix: str = "loiterstatus",
        loiter_bookmark_cooldown_seconds: float = 10.0,
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
        _label_map: dict[str, str] = {k.lower(): v for k, v in (label_type_map or {}).items()}

        topic_filter = f"{metadata_topic_prefix}/+"
        loiter_topic_filter = f"{metadata_topic_prefix}/+/{loiter_status_topic_suffix}"
        # (camera_id, track_id) -> time.monotonic() of the last bookmark pushed for it
        notified: dict[tuple[str, str], float] = {}

        logger.info(
            "mqtt_subscriber_starting",
            host=mqtt_host,
            port=mqtt_port,
            topic_filter=topic_filter,
            loiter_topic_filter=loiter_topic_filter if loiter_bookmark_enabled else None,
        )

        while True:
            try:
                async with aiomqtt.Client(mqtt_host, port=mqtt_port, tls_context=tls_context) as client:
                    await client.subscribe(topic_filter)
                    if loiter_bookmark_enabled:
                        await client.subscribe(loiter_topic_filter)
                    logger.info("mqtt_subscriber_subscribed", topic_filter=topic_filter)
                    async for message in client.messages:
                        topic = str(message.topic)
                        parts = topic.lstrip("/").split("/")
                        if loiter_bookmark_enabled and len(parts) == 3 and parts[-1] == loiter_status_topic_suffix:  # noqa: PLR2004
                            await self._handle_loiterstatus_message(
                                topic, message.payload, shim_map, notified, loiter_bookmark_cooldown_seconds,
                            )
                        else:
                            await self._handle_message(
                                topic,
                                message.payload,
                                shim_map,
                                _label_map,
                                timestamp_offset_ms,
                                zone_filter_enabled,
                                zones,
                                zone_type_id,
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
        label_type_map: dict[str, str] | None = None,
        timestamp_offset_ms: int = 0,
        zone_filter_enabled: bool = False,
        zones: dict[str, dict] | None = None,
        zone_type_id: str = "vap.zone",
    ) -> None:
        """Parse topic, translate payload, and dispatch to VMS shim."""
        import json

        # "{prefix}/{vendor}:{camera_id}" -> 2 segments; trailing segment holds vendor:camera_id
        parts = topic.lstrip("/").split("/")
        if len(parts) != 2 or ":" not in parts[-1]:  # noqa: PLR2004
            logger.warning("mqtt_unexpected_topic_format", topic=topic)
            return

        vms_name, camera_id = parts[-1].split(":", 1)

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
        objects, timestamp_ms = translate_dls_metadata(
            metadata,
            label_type_map,
            timestamp_offset_ms,
            zone_filter_enabled=zone_filter_enabled,
            zones=zones,
            zone_type_id=zone_type_id,
        )
        if not objects:
            logger.debug("mqtt_no_objects_in_frame", topic=topic)
            return

        device_id = camera_id

        ok = await shim.push_analytics_objects(device_id, objects, timestamp_ms)
        if not ok:
            logger.warning(
                "mqtt_push_failed",
                vms_name=vms_name,
                device_id=device_id,
                objects_count=len(objects),
            )
        else:
            logger.debug(
                "mqtt_pushed_objects",
                vms_name=vms_name,
                device_id=device_id,
                objects_count=len(objects),
                timestamp_ms=timestamp_ms,
            )

    async def _handle_loiterstatus_message(
        self,
        topic: str,
        payload: bytes,
        shim_map: dict[str, Any],
        notified: dict[tuple[str, str], float],
        cooldown_seconds: float,
    ) -> None:
        """Push an Nx bookmark for a track reported on the LD app's own loiterstatus topic.

        This consumes the loitering-detection recipe's dedicated threshold-crossing
        message (published by its mqtt-table-flattener sidecar once dwell time
        exceeds the threshold configured INSIDE that app) instead of recomputing
        that threshold check here. The flattener republishes one row per still-
        qualifying track on every publish cycle (~1s), so bookmarks are deduped
        per (camera, track) with a cooldown rather than firing on every row.
        """
        import json

        # "{prefix}/{vendor}:{camera_id}/{suffix}" -> 3 segments; middle segment holds vendor:camera_id
        parts = topic.lstrip("/").split("/")
        if len(parts) != 3 or ":" not in parts[1]:  # noqa: PLR2004
            logger.warning("mqtt_unexpected_loiterstatus_topic_format", topic=topic)
            return
        vms_name, device_id = parts[1].split(":", 1)

        shim = self._lookup_shim(shim_map, vms_name)
        if shim is None or not hasattr(shim, "set_bookmark"):
            return

        try:
            row = json.loads(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("mqtt_loiterstatus_parse_failed", topic=topic, error=str(exc))
            return

        track_id = row.get("Track ID")
        if track_id is None:
            return

        key = (device_id, str(track_id))
        now = time.monotonic()

        if len(notified) > _NOTIFIED_CACHE_PRUNE_THRESHOLD:
            cutoff = now - cooldown_seconds * 2
            for stale_key in [k for k, t in notified.items() if t < cutoff]:
                del notified[stale_key]

        last_notified = notified.get(key)
        notified[key] = now
        if last_notified is not None and (now - last_notified) <= cooldown_seconds:
            return  # still the same loitering episode - already bookmarked

        label = (
            f"{row.get('Type') or 'Object'} {track_id} loitering "
            f"{row.get('Dwell Time (s)', '?')}s in zone {row.get('Zone', '?')}"
        )
        camera_id = f"{vms_name}:{device_id}"
        try:
            ok = await shim.set_bookmark(camera_id, datetime.now(tz=timezone.utc), label)
            logger.info("loiter_bookmark_pushed", camera_id=camera_id, track_id=track_id, result=str(ok))
        except Exception as exc:  # noqa: BLE001 — non-fatal, keep subscriber running
            logger.warning("loiter_bookmark_failed", camera_id=camera_id, track_id=track_id, error=str(exc))
