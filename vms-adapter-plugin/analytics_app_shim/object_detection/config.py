# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Configuration model for the Object Detection (DL Streamer Pipeline Server) analytics app shim."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


_DEVICE_ORDER = ("CPU", "GPU", "NPU")


class ObjectDetectionAnalyticsAppConfig(BaseModel):
    """Config for DL Streamer Pipeline Server–based object detection apps (e.g. Loitering Detection)."""

    type: Literal["object_detection"] = "object_detection"
    # Identifies this app instance in API URLs (e.g. "dls_vision" → /v1/analytics-apps/dls_vision/runs)
    app_id: str = "dls_vision"
    display_name: str = "Object Detection"
    base_url: str  # Pipeline Server REST URL
    tls_verify: bool = False
    tls_ca_bundle: str = ""
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_tls_enabled: bool = False
    mqtt_ca_bundle: str = ""
    mqtt_client_cert: str = ""
    mqtt_client_key: str = ""
    # Topic prefix used to publish/subscribe inference metadata, matching the LD
    # app's OWN existing topic convention (see loitering-detection's
    # sample_start.sh: "${SOURCE_TOPIC_PREFIX:-object_tracking}/$x") instead of
    # VMS inventing its own naming scheme. Must match whatever SOURCE_TOPIC_PREFIX
    # the deployment's mqtt-table-flattener/.env is actually configured with.
    # Final topic = "{metadata_topic_prefix}/{vendor}:{device_id}", e.g.
    # "object_tracking/nx:e3e9a385-...".
    metadata_topic_prefix: str = "object_tracking"
    # Optional DLSPS-side zone config file path sent as the start payload's
    # "analytics-properties.config" (gvaanalytics zones JSON) - see
    # loitering-detection's sample_start.sh. Hardcoded/static for now (one zone
    # file per deployment); empty disables sending it (pipeline's own
    # config.json default is used instead).
    zone_config_path: str = ""
    # Maps detection labels (case-insensitive) to Nx Witness object typeIds.
    # Any label not present here falls back to "python.detected.object".
    # These typeIds are also merged into the Nx analytics manifest at startup
    # so that Nx accepts pushed objects for all configured types.
    # Example:
    #   label_type_map:
    #     car: vap.vehicle
    #     truck: vap.vehicle
    #     person: vap.person
    #     forklift: custom.forklift
    label_type_map: dict[str, str] = Field(default_factory=dict)
    # Compensates for the delay between frame capture and MQTT message arrival
    # (inference latency + pipeline overhead). A negative value shifts the pushed
    # metadata timestamp backward so it aligns with the corresponding video frame
    # in Nx. For example, -300 corrects for ~300 ms of inference latency.
    # Has no effect when sender_ntp_unix_timestamp_ns is present in the payload.
    metadata_timestamp_offset_ms: int = 0
    # Per-device pipeline mapping used by Nx UI controls and run startup.
    # At least one of CPU/GPU/NPU must be configured with a non-empty value.
    pipeline: dict[str, str] = Field(default_factory=dict)

    # Newer DLStreamer pipelines (gvaanalytics + zone config) compute zone
    # membership/dwell-time natively and surface it per-object as
    # "zone_violations" (list of zone ids) and "dwell_times" (list of
    # {zone_id, dwell_time_sec}). When enabled, only objects currently inside a
    # monitored zone are pushed to Nx — objects detected elsewhere in the
    # (now full-frame) detection are dropped. Has no effect on pipelines that
    # don't emit zone_violations/dwell_times (plain object-detection apps).
    zone_filter_enabled: bool = False
    # Static zone geometry to draw in Nx as a persistent marker box, since the
    # pipeline no longer emits a fake detection object for the ROI. Keyed by
    # zone id (must match the zone id in the DLSPS zones/<video>.json config).
    # bounding_box is normalized [x_min, y_min, x_max, y_max] (0-1), matching
    # the pixel polygon's bounding rect in that same zones JSON file.
    # Example:
    #   zones:
    #     region1:
    #       label: "Loitering Zone"
    #       bounding_box: [0.0, 0.2778, 0.2344, 0.5556]
    zones: dict[str, dict] = Field(default_factory=dict)
    # Nx typeId used for the pushed zone marker box(es); auto-registered via
    # object_types() when zones is non-empty.
    zone_type_id: str = "vap.zone"

    # The loitering-detection recipe's own mqtt-table-flattener sidecar already
    # decides when a track has crossed ITS loitering threshold (configured
    # inside the DLSPS pipeline/app, not here) and republishes one row per
    # qualifying track to "<this app's metadata topic>/<loiter_status_topic_suffix>".
    # When enabled, the plugin subscribes to that dedicated topic and pushes an
    # Nx bookmark the first time each track appears in it, instead of
    # re-deriving "is this object loitering" from dwell_time_sec itself.
    loiter_bookmark_enabled: bool = False
    # Must match the mqtt-table-flattener's DEST_TOPIC_SUFFIX env var.
    loiter_status_topic_suffix: str = "loiterstatus"
    # Minimum seconds between bookmarks for the same (camera, track) pair while
    # it keeps reappearing in the loiterstatus stream, so a still-loitering
    # object (republished every ~1s by the flattener) doesn't spam a bookmark
    # every cycle. A gap longer than this is treated as a new loitering episode.
    loiter_bookmark_cooldown_seconds: float = 10.0

    @model_validator(mode="after")
    def _normalize_and_validate_zones(self):
        normalized: dict[str, dict] = {}
        for zone_id, zone_cfg in (self.zones or {}).items():
            zone_cfg = dict(zone_cfg or {})
            bbox = zone_cfg.get("bounding_box")
            if not bbox or len(bbox) != 4:
                raise ValueError(
                    f"Zone '{zone_id}' bounding_box must be [x_min, y_min, x_max, y_max]"
                )
            zone_cfg["bounding_box"] = tuple(float(v) for v in bbox)
            normalized[str(zone_id)] = zone_cfg
        self.zones = normalized
        return self

    @model_validator(mode="after")
    def _normalize_and_validate_pipeline_map(self):
        normalized: dict[str, str] = {}
        for key, value in (self.pipeline or {}).items():
            device = str(key or "").strip().upper()
            name = str(value or "").strip()
            if not device or not name:
                continue
            if device not in _DEVICE_ORDER:
                raise ValueError(
                    f"Unsupported pipeline device '{device}'. Supported devices: {list(_DEVICE_ORDER)}"
                )
            normalized[device] = name

        if not normalized:
            raise ValueError(
                "Object Detection requires at least one configured pipeline: "
                "set one of pipeline.cpu, pipeline.gpu, or pipeline.npu"
            )

        self.pipeline = normalized
        return self

    def configured_pipeline_devices(self) -> list[str]:
        """Return configured devices in stable UI order."""
        return [device for device in _DEVICE_ORDER if self.pipeline.get(device)]

    def pipeline_for_device(self, device: str) -> str:
        """Return configured pipeline name for a given device (case-insensitive)."""
        return self.pipeline.get(str(device or "").strip().upper(), "")
    def object_types(self) -> list[str]:
        """Return the object type ids this app emits (VMS-neutral).

        Derived from ``label_type_map`` values so a VMS shim can register them
        generically, without knowing this app exists. Apps that do not push
        object detections simply omit this method. Also includes
        ``zone_type_id`` when zones are configured, since the zone marker
        box(es) are pushed with that typeId.
        """
        types = set(self.label_type_map.values())
        if self.zones:
            types.add(self.zone_type_id)
        return sorted(types)

    def control_params(self) -> list[dict]:
        """Declare this app's per-camera control knobs (VMS-neutral).

        A ``bool`` named ``pipelineEnabled`` is the start/stop toggle; ``device``
        selects the inference device. Only configured devices are exposed.
        A VMS shim renders these into its own UI.
        """
        device_options = self.configured_pipeline_devices()
        return [
            {
                "name": "pipelineEnabled",
                "type": "bool",
                "default": False,
                "label": f"Enable {self.display_name} pipeline",
                "description": f"Start or stop the {self.display_name} pipeline for this camera",
            },
            {
                "name": "device",
                "type": "enum",
                "default": device_options[0],
                "options": device_options,
                "label": "Device",
                "description": "Inference device mapped to a configured pipeline",
            },
        ]

