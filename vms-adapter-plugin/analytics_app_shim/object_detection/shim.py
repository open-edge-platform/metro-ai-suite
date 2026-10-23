# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Object Detection Analytics App shim.

Integrates a DL Streamer Pipeline Server–based object detection application
(e.g. DL Streamer Vision) as a VAP analytics app.

Data flow:
  Camera RTSP ──► DL Streamer Pipeline Server
                  └─► inference metadata via MQTT → MqttSubscriber
                                                      └─► Nx analytics push

Architecture
────────────
``ObjectDetectionAnalyticsAppShim`` is composed of:

* :class:`~.api_client.ObjectDetectionApiClient`  — HTTP calls to the Pipeline Server
* :class:`~.mqtt_subscriber.MqttSubscriber`        — started externally by the orchestrator

This shim implements :class:`~plugin.base.interfaces.IAnalyticsAppShim` so the
generic ``/v1/analytics-apps/{app_id}/…`` routes work without app-specific code.
"""

from __future__ import annotations

import asyncio
import copy
import json
import ssl
from typing import TYPE_CHECKING, Any

import structlog
from pydantic import BaseModel, create_model

from plugin.base.interfaces import IAnalyticsAppShim
from plugin.core.models.domain import AnalysisResult, MetadataEvent
from .config import ObjectDetectionAnalyticsAppConfig
from .api_client import ObjectDetectionApiClient

if TYPE_CHECKING:
    from plugin.core.factory import VmsShimSet
    from plugin.core.pipeline.orchestrator import Orchestrator

logger = structlog.get_logger(__name__)


def _make_tls_context(cfg) -> ssl.SSLContext | None:
    """Build an SSLContext from ObjectDetectionAnalyticsAppConfig MQTT TLS fields, or None when disabled."""
    if not cfg.mqtt_tls_enabled:
        return None
    ctx = ssl.create_default_context(cafile=cfg.mqtt_ca_bundle or None)
    if cfg.mqtt_client_cert and cfg.mqtt_client_key:
        ctx.load_cert_chain(certfile=cfg.mqtt_client_cert, keyfile=cfg.mqtt_client_key)
    return ctx


class ObjectDetectionAnalyticsAppShim(IAnalyticsAppShim):
    """IAnalyticsAppShim implementation for DL Streamer Pipeline Server–based apps."""

    def __init__(self, config: ObjectDetectionAnalyticsAppConfig) -> None:
        self._config = config
        self._api = ObjectDetectionApiClient(
            base_url=config.base_url,
            tls_verify=config.tls_verify,
            tls_ca_bundle=config.tls_ca_bundle,
        )
        self._param_model: type[BaseModel] = BaseModel
        # Maps pipeline version (user-facing name) → pipeline root (URL path segment)
        # e.g. "dls_vision_pipeline" → "user_defined_pipelines"
        self._pipeline_root_map: dict[str, str] = {}
        # Tracks active runs: run_id (= instance_id hex) → run metadata
        self._runs: dict[str, dict[str, Any]] = {}
        # Needed to look up the originating VMS shim for camera-resolution lookups
        # when translating a user-entered normalized zone to pixel coordinates.
        self._vms_shim_sets: list[VmsShimSet] = []

    @property
    def app_id(self) -> str:  # type: ignore[override]
        return self._config.app_id

    @property
    def display_name(self) -> str:  # type: ignore[override]
        return self._config.display_name

    async def on_startup(self, orchestrator: Orchestrator) -> None:
        """Start object detection MQTT subscriber background task."""
        self._vms_shim_sets = orchestrator.vms_shim_sets
        from analytics_app_shim.object_detection.mqtt_subscriber import MqttSubscriber
        subscriber = MqttSubscriber()
        task = asyncio.create_task(
            subscriber.run(
                mqtt_host=self._config.mqtt_host,
                mqtt_port=self._config.mqtt_port,
                vms_shim_sets=orchestrator.vms_shim_sets,
                label_type_map=self._config.label_type_map,
                timestamp_offset_ms=self._config.metadata_timestamp_offset_ms,
                tls_context=_make_tls_context(self._config),
                zone_filter_enabled=self._config.zone_filter_enabled,
                zones=self._config.zones,
                zone_type_id=self._config.zone_type_id,
                metadata_topic_prefix=self._config.metadata_topic_prefix,
                event_bookmark_enabled=self._config.event_bookmark_enabled,
                event_topic_suffix=self._config.event_topic_suffix,
            ),
            name=f"mqtt-subscriber-{self.app_id}",
        )
        orchestrator.add_background_task(task)
        logger.info(
            "mqtt_subscriber_task_started",
            app_id=self.app_id,
            mqtt_host=self._config.mqtt_host,
            mqtt_port=self._config.mqtt_port,
        )

    @property
    def param_model(self) -> type[BaseModel]:
        return self._param_model

    # ── IAnalyticsAppShim — schema ─────────────────────────────────────────────────

    async def fetch_schema(self) -> dict[str, Any]:
        """Build a JSON Schema from the available pipeline templates.

        Calls ``GET /pipelines``. Each entry has:
          - ``name``:    pipeline root directory (e.g. "user_defined_pipelines")
          - ``version``: user-facing pipeline identifier (e.g. "dls_vision_pipeline")

        The UI ``pipeline_name`` field shows the ``version`` values.  The root
        is stored in ``_pipeline_root_map`` so ``start()`` can construct the
        correct POST URL: ``/pipelines/{root}/{version}``.
        """
        pipelines = await self._api.list_pipelines()

        self._pipeline_root_map = {}
        for p in pipelines:
            if not isinstance(p, dict):
                continue
            root = p.get("name", "user_defined_pipelines")
            version = p.get("version", "")
            if version:
                self._pipeline_root_map[version] = root

        device_options = self._config.configured_pipeline_devices()

        schema: dict[str, Any] = {
            "type": "object",
            "title": f"{self.display_name} Start Parameters",
            "required": ["camera_id", "device"],
            "properties": {
                "camera_id": {
                    "type": "string",
                    "title": "Camera",
                    "description": "Camera to process (RTSP URL resolved automatically)",
                    "x-vms-source": "camera-id",
                },
                "device": {
                    "type": "string",
                    "title": "Device",
                    "description": "Inference device mapped to a configured pipeline",
                    "enum": device_options,
                    "default": device_options[0] if device_options else "CPU",
                },
                "zone": {
                    "type": "string",
                    "title": "Loitering Zone",
                    "description": (
                        "Normalized zone polygon as [[x,y],...] points, each 0-1 "
                        "(fraction of frame width/height)"
                    ),
                },
            },
        }

        self._param_model = create_model(
            "OdStartParams",
            camera_id=(str, ...),
            camera_id_ref=(str, ""),   # original camera_id before RTSP resolution (e.g. "nx:abc123")
            device=(str, ""),
            zone=(str, ""),
        )

        return schema

    # ── IAnalyticsAppShim — lifecycle ──────────────────────────────────────────────

    def _build_mqtt_topic(self, camera_id_ref: str) -> str:
        """Build the MQTT publish topic from the original camera_id.

        Format: ``{metadata_topic_prefix}/{vendor_prefix}:{device_id}``
        Example: ``object_tracking/nx:e3e9a385-7fe0-3ba5-5482-a86cde7faf48``

        Uses the LD app's OWN existing topic convention (``metadata_topic_prefix``,
        matching its ``SOURCE_TOPIC_PREFIX``) rather than a VMS-invented scheme, so
        the recipe's mqtt-table-flattener needs no reconfiguration. The subscriber
        listens on ``{metadata_topic_prefix}/+`` and splits the trailing
        ``vendor:device_id`` segment to find the right VMS shim.
        """
        ref = camera_id_ref or "vap:unknown"
        return f"{self._config.metadata_topic_prefix}/{ref}"

    def _lookup_vms_shim(self, camera_id_ref: str) -> Any | None:
        """Exact match first, then prefix match, mirroring MqttSubscriber._lookup_shim."""
        if ":" not in camera_id_ref:
            return None
        vendor_prefix, _ = camera_id_ref.split(":", 1)
        shim_map = {ss.name: ss.vms_shim for ss in self._vms_shim_sets}
        return shim_map.get(vendor_prefix) or next(
            (v for k, v in shim_map.items() if k.startswith(vendor_prefix)), None
        )

    async def _get_camera_resolution(self, camera_id_ref: str) -> tuple[int, int] | None:
        """Best-effort camera pixel resolution via the VMS's own camera metadata.

        Nx exposes it as ``vendor_meta.options.bitrateInfos[].resolution`` (e.g.
        "1280x720"). Returns None if the VMS/camera doesn't expose it.
        """
        shim = self._lookup_vms_shim(camera_id_ref)
        if shim is None:
            return None
        try:
            camera = await shim.get_camera_metadata(camera_id_ref)
        except Exception as exc:  # noqa: BLE001 — best-effort, never fatal
            logger.warning("od_camera_resolution_lookup_failed", camera_id_ref=camera_id_ref, error=str(exc))
            return None
        if camera is None:
            return None
        bitrate_infos = (camera.vendor_meta.get("options") or {}).get("bitrateInfos") or []
        for info in bitrate_infos:
            resolution = info.get("resolution", "")
            if "x" not in resolution:
                continue
            width_str, _, height_str = resolution.partition("x")
            try:
                return int(width_str), int(height_str)
            except ValueError:
                continue
        return None

    async def _build_zone_payload(self, zone_raw: str, camera_id_ref: str) -> str | None:
        """Convert a user-entered normalized zone polygon to the pixel JSON DLSPS expects.

        ``zone_raw`` is a JSON string of [[x,y],...] points, each normalized 0-1.
        Returns None (logging why) if the input is malformed or the camera's
        resolution can't be determined - never sends a guessed/wrong zone.
        """
        try:
            points = json.loads(zone_raw)
        except (json.JSONDecodeError, ValueError):
            logger.warning("od_zone_parse_failed", zone_raw=zone_raw)
            return None
        if not isinstance(points, list) or len(points) < 3:
            logger.warning("od_zone_invalid_polygon", zone_raw=zone_raw)
            return None

        resolution = await self._get_camera_resolution(camera_id_ref)
        if resolution is None:
            logger.warning("od_zone_resolution_unavailable", camera_id_ref=camera_id_ref)
            return None
        frame_w, frame_h = resolution

        pixel_points = []
        for point in points:
            if not (isinstance(point, (list, tuple)) and len(point) == 2):  # noqa: PLR2004
                logger.warning("od_zone_invalid_point", point=point)
                return None
            x, y = point
            pixel_points.append({"x": round(float(x) * frame_w), "y": round(float(y) * frame_h)})

        zone = {
            "id": "vap_zone",
            "type": "polygon",
            "points": pixel_points,
            "track-dwell-time": True,
            "object-retention": 1.0,
        }
        return json.dumps([zone])

    async def is_reachable(self) -> bool:
        return await self._api.is_reachable()

    async def start(self, params: BaseModel) -> dict[str, Any]:
        """Start a pipeline run for the given camera.

        The ``camera_id`` field is resolved to an RTSP URL by the generic
        run route before this method is called (see ``camera_fields()``).

        Payload sent to Pipeline Server::

            {
              "source": {"uri": "<rtsp_url>", "type": "uri"},
              "parameters": { ...extra_params from the ``parameters`` field }
            }
        """
        data = params.model_dump() if hasattr(params, "model_dump") else dict(params)

        pipeline_name: str = data.get("pipeline_name", "")
        stream_url: str = data.get("camera_id", "")
        extra_params: dict = data.get("parameters", {}) or {}
        camera_id_ref: str = data.get("camera_id_ref", "")
        device: str = str(data.get("device", "") or "").strip().upper()

        if not stream_url:
            raise ValueError("camera_id / stream URL is required")

        # Device-driven selection: map the chosen device → configured pipeline and
        # hardcode the DL Streamer detection-properties device (same as the Nx UI flow).
        if device:
            configured = self._config.configured_pipeline_devices()
            if device not in configured:
                device = configured[0] if configured else device
            pipeline_name = self._config.pipeline_for_device(device)
            extra_params = {"detection-properties": {"device": device}}

        zone_raw = str(data.get("zone", "") or "").strip()
        if zone_raw:
            zones_json = await self._build_zone_payload(zone_raw, camera_id_ref)
            if zones_json:
                extra_params = dict(extra_params)
                extra_params["analytics-properties"] = {
                    **extra_params.get("analytics-properties", {}),
                    "zones": zones_json,
                }

        if not pipeline_name:
            raise ValueError("pipeline_name is required")

        pipeline_root = self._pipeline_root_map.get(pipeline_name, "user_defined_pipelines")

        # Build MQTT topic from the original camera_id (e.g. "nx:abc123")
        # Topic format: "{metadata_topic_prefix}/{vendor_prefix}:{device_id}" → matches
        # subscriber filter "{metadata_topic_prefix}/+"
        # e.g. "object_tracking/nx:e3e9a385-7fe0-3ba5-5482-a86cde7faf48"
        mqtt_topic = self._build_mqtt_topic(camera_id_ref)

        payload: dict[str, Any] = {
            "source": {
                "uri": stream_url,
                "type": "uri",
                "properties": {
                    "protocols": "tcp",
                    "add-reference-timestamp-meta": True,
                    "latency": 100,
                },
            },
            "destination": {
                "metadata": {
                    "type": "mqtt",
                    "topic": mqtt_topic
                },
            },
            "parameters": extra_params,
        }
        logger.info("-"*100)
        # log payload with rtsp url redacted
        redacted_payload = copy.deepcopy(payload)
        if "source" in redacted_payload:
            if "uri" in redacted_payload["source"]:
                redacted_payload["source"]["uri"] = "REDACTED_RSTP_URL"
        logger.info(redacted_payload)
        logger.info("-"*100)

        result = await self._api.start_run(pipeline_root, pipeline_name, payload)
        if result is None:
            raise RuntimeError(
                f"Pipeline Server failed to start pipeline '{pipeline_root}/{pipeline_name}'"
            )

        # instance_id is a hex UUID string returned by the Pipeline Server
        instance_id: str = str(result.get("instance_id") or result.get("id") or "")
        run_id = instance_id  # already URL-safe hex string

        self._runs[run_id] = {
            "run_id": run_id,
            "pipeline_name": pipeline_name,
            "pipeline_root": pipeline_root,
            "stream_url": stream_url,
        }

        logger.info("od_run_started", run_id=run_id, pipeline=f"{pipeline_root}/{pipeline_name}")
        return {
            "run_id": run_id,
            "pipeline_name": pipeline_name,
            "pipeline_root": pipeline_root,
        }

    # ── IAnalyticsAppShim — run management ─────────────────────────────────────────

    async def list_runs(self) -> list[dict[str, Any]]:
        return await self._api.list_runs()

    async def stop_run(self, run_id: str) -> bool:
        """Stop a pipeline instance by its hex UUID run_id."""
        ok = await self._api.stop_run(run_id)
        if ok:
            self._runs.pop(run_id, None)
        return ok

    # ── VMS-driven pipeline control ─────────────────────────────────────────────

    def control_params(self) -> list[dict]:
        """Declare VMS-neutral control knobs for this app (delegates to config)."""
        return self._config.control_params()

    async def start_for_camera(self, camera_id: str, stream_url: str, controls: dict) -> str | None:
        """Start a DL Streamer pipeline for one camera from VMS control values.

        Device → pipeline mapping and hardcoded detection params are handled by
        :meth:`start`, so the Nx UI and the dashboard minimal form share one path.
        """
        # _param_model is bare BaseModel until fetch_schema() runs; guard against
        # the unlikely race where the polling task fires before schema fetch completes.
        if not self._pipeline_root_map:
            logger.warning("od_schema_not_ready", app_id=self.app_id)
            return None

        params = self._param_model.model_validate({
            "camera_id": stream_url,
            "camera_id_ref": camera_id,
            "device": str(controls.get("device", "")),
            "zone": str(controls.get("zone", "")),
        })
        try:
            result = await self.start(params)
            return result.get("run_id") or None
        except Exception as exc:
            logger.error("od_start_for_camera_failed", app_id=self.app_id, error=str(exc))
            return None

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        """Get status of a pipeline instance by its hex UUID run_id."""
        return await self._api.get_run(run_id)

    # ── IAnalyticsAppShim — deliver (not used — push model) ────────────────────────

    async def deliver(
        self, event: MetadataEvent, clip_path: str,
    ) -> AnalysisResult | None:
        """Not used: object detection uses MQTT push model, not event-triggered pull."""
        logger.debug("od_deliver_noop", event_id=event.event_id)
        return None

    def camera_fields(self) -> list[str]:
        """Return the field that holds camera IDs, triggering RTSP resolution."""
        return ["camera_id"]
