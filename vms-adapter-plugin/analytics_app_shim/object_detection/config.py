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
    # Topic prefix for metadata pub/sub, matching the LD app's own SOURCE_TOPIC_PREFIX
    # convention (not a VMS-invented scheme). Final topic:
    # "{metadata_topic_prefix}/{vendor}:{device_id}". Part of the pipeline-start payload.
    metadata_topic_prefix: str = "object_tracking"
    # DLSPS zone config path, sent as the start payload's "analytics-properties.config".
    # Empty = pipeline's own config.json default is used instead.
    zone_config_path: str = ""
    # Maps detection labels (case-insensitive) to Nx typeIds; unmapped labels fall
    # back to "python.detected.object". Also merged into the Nx manifest at startup.
    # Example: {car: vap.vehicle, person: vap.person}
    label_type_map: dict[str, str] = Field(default_factory=dict)
    # Shifts the pushed metadata timestamp (ms) to compensate for pipeline latency;
    # ignored when sender_ntp_unix_timestamp_ns is present in the payload.
    metadata_timestamp_offset_ms: int = 0
    # Per-device pipeline mapping used by Nx UI controls and run startup.
    # At least one of CPU/GPU/NPU must be configured with a non-empty value.
    pipeline: dict[str, str] = Field(default_factory=dict)

    # Only push objects with a "zone_violations"/"dwell_times" entry (gvaanalytics
    # zone/dwell output); no-op on pipelines that don't emit those fields.
    zone_filter_enabled: bool = False
    # Zone geometry drawn as a persistent marker box in Nx (replaces the fake ROI
    # object older pipelines emitted). bounding_box is normalized [x_min, y_min,
    # x_max, y_max]; keyed by zone id, must match the DLSPS zones/<video>.json.
    # Example: {region1: {label: "Loitering Zone", bounding_box: [0, 0.28, 0.23, 0.56]}}
    zones: dict[str, dict] = Field(default_factory=dict)
    # Nx typeId for the pushed zone marker box(es); auto-registered when zones is set.
    zone_type_id: str = "vap.zone"

    # Subscribes to the LD recipe's dedicated loiterstatus topic (mqtt-table-flattener
    # sidecar) and pushes an Nx bookmark for every row received - no dedup/threshold
    # logic here, the LD app already decided the track is loitering.
    loiter_bookmark_enabled: bool = False
    # Must match the mqtt-table-flattener's DEST_TOPIC_SUFFIX env var.
    loiter_status_topic_suffix: str = "loiterstatus"

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
        """Object type ids this app emits (label_type_map values, plus zone_type_id if zones is set)."""
        types = set(self.label_type_map.values())
        if self.zones:
            types.add(self.zone_type_id)
        return sorted(types)

    def control_params(self) -> list[dict]:
        """Per-camera control knobs (VMS-neutral): pipelineEnabled toggle + device enum."""
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

