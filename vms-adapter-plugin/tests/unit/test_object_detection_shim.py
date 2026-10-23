# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ObjectDetectionAnalyticsAppShim."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from analytics_app_shim.object_detection import api_client as od_api_client_module
from analytics_app_shim.object_detection.api_client import ObjectDetectionApiClient
from analytics_app_shim.object_detection.shim import ObjectDetectionAnalyticsAppShim
from analytics_app_shim.object_detection.config import ObjectDetectionAnalyticsAppConfig
from plugin.core.factory import VmsShimSet
from plugin.core.models.domain import Camera


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_config(**kwargs) -> ObjectDetectionAnalyticsAppConfig:
    defaults = {
        "type": "object_detection",
        "app_id": "dls_vision",
        "display_name": "DL Streamer Vision",
        "base_url": "https://localhost:443/api",
        "mqtt_host": "localhost",
        "mqtt_port": 1883,
        "pipeline": {"cpu": "dls_vision_pipeline"},
    }
    defaults.update(kwargs)
    return ObjectDetectionAnalyticsAppConfig(**defaults)


def _make_shim(**kwargs) -> ObjectDetectionAnalyticsAppShim:
    return ObjectDetectionAnalyticsAppShim(_make_config(**kwargs))


# ── Basic identity ─────────────────────────────────────────────────────────────

def test_shim_app_id():
    shim = _make_shim()
    assert shim.app_id == "dls_vision"


def test_shim_display_name():
    shim = _make_shim(display_name="My DL Streamer Vision App")
    assert shim.display_name == "My DL Streamer Vision App"


def test_shim_implements_interface():
    from plugin.base.interfaces import IAnalyticsAppShim
    shim = _make_shim()
    assert isinstance(shim, IAnalyticsAppShim)


def test_camera_fields_returns_camera_id():
    shim = _make_shim()
    assert shim.camera_fields() == ["camera_id"]


# ── fetch_schema ──────────────────────────────────────────────────────────────

async def test_fetch_schema_returns_object_schema():
    shim = _make_shim()
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "dls_vision_pipeline"},
    ])

    schema = await shim.fetch_schema()

    assert schema["type"] == "object"
    assert "device" in schema["properties"]
    assert "camera_id" in schema["properties"]
    assert set(schema["required"]) == {"device", "camera_id"}


async def test_fetch_schema_device_enum_reflects_configured_devices():
    """Device enum exposes only configured pipeline devices, in UI order."""
    shim = _make_shim(pipeline={"cpu": "pipeline_cpu", "gpu": "pipeline_gpu"})
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "pipeline_cpu"},
        {"name": "user_defined_pipelines", "version": "pipeline_gpu"},
    ])
    schema = await shim.fetch_schema()
    assert schema["properties"]["device"]["enum"] == ["CPU", "GPU"]


async def test_fetch_schema_builds_pipeline_root_map():
    """_pipeline_root_map maps version → root for correct POST URL."""
    shim = _make_shim()
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "dls_vision_pipeline"},
    ])
    await shim.fetch_schema()
    assert shim._pipeline_root_map == {"dls_vision_pipeline": "user_defined_pipelines"}


async def test_fetch_schema_handles_empty_pipeline_list():
    shim = _make_shim()
    shim._api.list_pipelines = AsyncMock(return_value=[])
    schema = await shim.fetch_schema()
    # No pipeline templates available yet — root map is empty; device still exposed.
    assert shim._pipeline_root_map == {}
    assert schema["properties"]["device"]["enum"] == ["CPU"]


async def test_fetch_schema_includes_zone_field():
    shim = _make_shim()
    shim._api.list_pipelines = AsyncMock(return_value=[])
    schema = await shim.fetch_schema()
    assert schema["properties"]["zone"]["description"]
    assert "normalized" in schema["properties"]["zone"]["description"].lower()


def test_config_requires_at_least_one_pipeline():
    with pytest.raises(ValueError, match="at least one configured pipeline"):
        ObjectDetectionAnalyticsAppConfig(
            type="object_detection",
            app_id="dls_vision",
            display_name="DL Streamer Vision",
            base_url="https://localhost:443/api",
            pipeline={},
        )


def test_control_params_include_only_configured_devices():
    cfg = _make_config(pipeline={"cpu": "p-cpu", "gpu": "p-gpu", "npu": ""})
    controls = cfg.control_params()
    device = next(c for c in controls if c["name"] == "device")
    assert device["options"] == ["CPU", "GPU"]
    assert device["default"] == "CPU"


def test_control_params_include_zone_with_normalized_default():
    cfg = _make_config()
    controls = cfg.control_params()
    zone = next(c for c in controls if c["name"] == "zone")
    assert zone["type"] == "text"
    assert "normalized" in zone["description"].lower()
    default_points = json.loads(zone["default"])
    assert default_points == [[0.0, 0.2778], [0.2344, 0.2778], [0.2344, 0.5556], [0.0, 0.5556]]


# ── zones config ──────────────────────────────────────────────────────────────

def test_object_types_excludes_zone_type_id_when_no_zones():
    cfg = _make_config(label_type_map={"pedestrian": "vap.pedestrian"})
    assert cfg.object_types() == ["vap.pedestrian"]


def test_object_types_includes_zone_type_id_when_zones_configured():
    cfg = _make_config(
        label_type_map={"pedestrian": "vap.pedestrian"},
        zones={"region1": {"bounding_box": [0.0, 0.0, 0.5, 0.5]}},
    )
    assert cfg.object_types() == ["vap.pedestrian", "vap.zone"]


def test_zones_bounding_box_normalized_to_tuple():
    cfg = _make_config(zones={"region1": {"bounding_box": [0, 0.2, 0.3, 0.4]}})
    assert cfg.zones["region1"]["bounding_box"] == (0.0, 0.2, 0.3, 0.4)


def test_zone_missing_bounding_box_raises():
    with pytest.raises(ValueError, match="bounding_box"):
        _make_config(zones={"region1": {"label": "Zone"}})


def test_zone_filter_enabled_defaults_false():
    cfg = _make_config()
    assert cfg.zone_filter_enabled is False


def test_event_bookmark_config_defaults():
    cfg = _make_config()
    assert cfg.event_bookmark_enabled is False
    assert cfg.event_topic_suffix == "loiterstatus"


# ── is_reachable ──────────────────────────────────────────────────────────────

async def test_is_reachable_delegates_to_api_client():
    shim = _make_shim()
    shim._api.is_reachable = AsyncMock(return_value=True)
    assert await shim.is_reachable() is True

    shim._api.is_reachable = AsyncMock(return_value=False)
    assert await shim.is_reachable() is False


# ── start ─────────────────────────────────────────────────────────────────────

async def test_start_creates_run():
    """start() posts to /{pipeline_root}/{pipeline_version} and returns run_id=instance_id."""
    shim = _make_shim()
    shim._pipeline_root_map = {"dls_vision_pipeline": "user_defined_pipelines"}
    shim._api.start_run = AsyncMock(
        return_value={"instance_id": "4b36b3ce52ad11f0ad60863f511204e2"}
    )

    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "dls_vision_pipeline",
        "camera_id": "rtsp://cam:554/stream",
        "camera_id_ref": "nx:e3e9a385-7fe0-3ba5-5482-a86cde7faf48",
        "parameters": {},
    }

    result = await shim.start(params)

    shim._api.start_run.assert_called_once_with(
        "user_defined_pipelines",
        "dls_vision_pipeline",
        {
            "source": {"uri": "rtsp://cam:554/stream", "type": "uri", "properties": {"protocols": "tcp", "add-reference-timestamp-meta": True, "latency": 100}},
            "destination": {"metadata": {"type": "mqtt", "topic": "object_tracking/nx:e3e9a385-7fe0-3ba5-5482-a86cde7faf48"}},
            "parameters": {},
        },
    )
    assert result["run_id"] == "4b36b3ce52ad11f0ad60863f511204e2"
    assert result["pipeline_name"] == "dls_vision_pipeline"


async def test_start_uses_default_root_when_not_in_map():
    """If pipeline_root_map is empty, defaults to 'user_defined_pipelines'."""
    shim = _make_shim()
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})

    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "some_pipeline",
        "camera_id": "rtsp://cam/s",
        "camera_id_ref": "",
        "parameters": {},
    }
    await shim.start(params)
    shim._api.start_run.assert_called_once_with(
        "user_defined_pipelines",
        "some_pipeline",
        {
            "source": {"uri": "rtsp://cam/s", "type": "uri", "properties": {"protocols": "tcp", "add-reference-timestamp-meta": True, "latency": 100}},
            "destination": {"metadata": {"type": "mqtt", "topic": "object_tracking/vap:unknown"}},
            "parameters": {},
        },
    )


def test_build_mqtt_topic_uses_configured_prefix():
    shim = _make_shim(metadata_topic_prefix="object_tracking")
    assert shim._build_mqtt_topic("nx:abc123") == "object_tracking/nx:abc123"


# ── per-camera zone: resolution lookup + normalized->pixel translation ────────

def _camera_with_resolution(resolution: str = "1280x720") -> Camera:
    return Camera(
        camera_id="nx:abc123",
        name="cam",
        vendor="nx_witness",
        vendor_meta={"options": {"bitrateInfos": [{"encoderIndex": "primary", "resolution": resolution}]}},
    )


def _vms_shim_set(name: str, vms_shim) -> VmsShimSet:
    return VmsShimSet(name=name, config=MagicMock(), vms_shim=vms_shim)


def test_lookup_vms_shim_exact_and_prefix_match(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    assert shim._lookup_vms_shim("nx:abc123") is mock_vms_shim


def test_lookup_vms_shim_none_when_no_colon():
    shim = _make_shim()
    assert shim._lookup_vms_shim("abc123") is None


async def test_get_camera_resolution_parses_bitrate_info(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution("1920x1080"))

    resolution = await shim._get_camera_resolution("nx:abc123")

    assert resolution == (1920, 1080)


async def test_get_camera_resolution_none_when_shim_missing():
    shim = _make_shim()
    assert await shim._get_camera_resolution("nx:abc123") is None


async def test_get_camera_resolution_none_when_camera_metadata_missing(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=None)

    assert await shim._get_camera_resolution("nx:abc123") is None


async def test_build_zone_payload_converts_normalized_points_to_pixel(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution("1280x720"))

    zones_json = await shim._build_zone_payload(
        "[[0.0, 0.2778], [0.2344, 0.2778], [0.2344, 0.5556], [0.0, 0.5556]]", "nx:abc123",
    )

    parsed = json.loads(zones_json)
    assert parsed == [
        {
            "id": "vap_zone",
            "type": "polygon",
            "points": [
                {"x": 0, "y": 200},
                {"x": 300, "y": 200},
                {"x": 300, "y": 400},
                {"x": 0, "y": 400},
            ],
            "track-dwell-time": True,
            "object-retention": 1.0,
        },
    ]


async def test_build_zone_payload_none_on_malformed_json():
    shim = _make_shim()
    assert await shim._build_zone_payload("not json", "nx:abc123") is None


async def test_build_zone_payload_none_on_too_few_points():
    shim = _make_shim()
    assert await shim._build_zone_payload("[[0.1, 0.1], [0.2, 0.2]]", "nx:abc123") is None


async def test_build_zone_payload_none_when_resolution_unavailable():
    shim = _make_shim()
    # No vms_shim_sets registered -> resolution lookup fails.
    result = await shim._build_zone_payload("[[0,0],[1,0],[1,1]]", "nx:abc123")
    assert result is None


async def test_build_zone_payload_none_on_malformed_point(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution())

    result = await shim._build_zone_payload("[[0,0],[1,0,5],[1,1]]", "nx:abc123")

    assert result is None


async def test_start_sends_zone_payload_when_provided(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution())
    shim._pipeline_root_map = {"dls_vision_pipeline": "user_defined_pipelines"}
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})

    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "dls_vision_pipeline",
        "camera_id": "rtsp://cam/s",
        "camera_id_ref": "nx:abc123",
        "zone": "[[0.0, 0.2778], [0.2344, 0.2778], [0.2344, 0.5556], [0.0, 0.5556]]",
        "parameters": {},
    }
    await shim.start(params)

    sent_payload = shim._api.start_run.call_args.args[2]
    zones_sent = json.loads(sent_payload["parameters"]["analytics-properties"]["zones"])
    assert zones_sent[0]["id"] == "vap_zone"


async def test_start_for_camera_passes_zone_control():
    shim = _make_shim(pipeline={"cpu": "pipeline_cpu"})
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "pipeline_cpu"},
    ])
    await shim.fetch_schema()
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})

    await shim.start_for_camera(
        camera_id="nx:cam-1",
        stream_url="rtsp://cam/s",
        controls={"pipelineEnabled": True, "device": "CPU", "zone": "[[0,0],[1,0],[1,1]]"},
    )

    sent_payload = shim._api.start_run.call_args.args[2]
    # No vms_shim registered -> resolution lookup fails -> zone silently dropped,
    # but start() must not raise just because the zone couldn't be translated.
    assert "analytics-properties" not in sent_payload["parameters"]


async def test_start_raises_on_missing_pipeline_name():
    shim = _make_shim()
    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "",
        "camera_id": "rtsp://cam/stream",
        "parameters": {},
    }
    with pytest.raises(ValueError, match="pipeline_name"):
        await shim.start(params)


async def test_start_raises_on_api_failure():
    shim = _make_shim()
    shim._api.start_run = AsyncMock(return_value=None)

    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "dls_vision_pipeline",
        "camera_id": "rtsp://x/y",
        "parameters": {},
    }
    with pytest.raises(RuntimeError):
        await shim.start(params)


# ── stop_run ──────────────────────────────────────────────────────────────────

async def test_stop_run_calls_api_with_instance_id():
    """stop_run() passes run_id (hex UUID) directly to the API — no name/version lookup."""
    shim = _make_shim()
    run_id = "4b36b3ce52ad11f0ad60863f511204e2"
    shim._api.stop_run = AsyncMock(return_value=True)

    ok = await shim.stop_run(run_id)

    shim._api.stop_run.assert_called_once_with(run_id)
    assert ok is True


async def test_stop_run_clears_cache_on_success():
    """Successful stop removes the entry from _runs cache."""
    shim = _make_shim()
    run_id = "abc123"
    shim._runs[run_id] = {"run_id": run_id, "pipeline_name": "pd"}
    shim._api.stop_run = AsyncMock(return_value=True)

    await shim.stop_run(run_id)

    assert run_id not in shim._runs


async def test_stop_run_not_in_cache_still_calls_api():
    """stop_run() does NOT require the cache — it calls the API directly."""
    shim = _make_shim()
    shim._api.stop_run = AsyncMock(return_value=False)
    ok = await shim.stop_run("unknown-id")
    shim._api.stop_run.assert_called_once_with("unknown-id")
    assert ok is False


async def test_start_for_camera_uses_pipeline_for_selected_device():
    shim = _make_shim(pipeline={"cpu": "pipeline_cpu", "gpu": "pipeline_gpu"})
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "pipeline_cpu"},
        {"name": "user_defined_pipelines", "version": "pipeline_gpu"},
    ])
    await shim.fetch_schema()
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})

    run_id = await shim.start_for_camera(
        camera_id="nx:cam-1",
        stream_url="rtsp://cam/s",
        controls={"pipelineEnabled": True, "device": "GPU"},
    )

    assert run_id == "abc123"
    shim._api.start_run.assert_called_once_with(
        "user_defined_pipelines",
        "pipeline_gpu",
        {
            "source": {
                "uri": "rtsp://cam/s",
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
                    "topic": "object_tracking/nx:cam-1",
                },
            },
            "parameters": {"detection-properties": {"device": "GPU"}},
        },
    )


async def test_start_for_camera_invalid_device_falls_back_to_first_configured():
    shim = _make_shim(pipeline={"cpu": "pipeline_cpu", "npu": "pipeline_npu"})
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "pipeline_cpu"},
        {"name": "user_defined_pipelines", "version": "pipeline_npu"},
    ])
    await shim.fetch_schema()
    shim._api.start_run = AsyncMock(return_value={"instance_id": "run-cpu"})

    run_id = await shim.start_for_camera(
        camera_id="nx:cam-2",
        stream_url="rtsp://cam2/s",
        controls={"pipelineEnabled": True, "device": "TPU"},
    )

    assert run_id == "run-cpu"
    called_payload = shim._api.start_run.call_args[0][2]
    assert shim._api.start_run.call_args[0][1] == "pipeline_cpu"
    assert called_payload["parameters"]["detection-properties"]["device"] == "CPU"


# ── deliver (no-op) ──────────────────────────────────────────────────────────

async def test_deliver_returns_none():
    shim = _make_shim()
    from plugin.core.models.domain import MetadataEvent
    event = MagicMock(spec=MetadataEvent)
    event.event_id = "test-evt"
    result = await shim.deliver(event, "/tmp/clip.mp4")
    assert result is None


def test_shim_passes_tls_settings_to_api_client():
    shim = _make_shim(tls_verify=True, tls_ca_bundle="/tmp/od-ca.pem")
    assert shim._api._tls_verify is True
    assert shim._api._tls_ca_bundle == "/tmp/od-ca.pem"


def test_api_client_default_verify_is_false(monkeypatch):
    captured: dict = {}

    def _fake_async_client(*args, **kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(od_api_client_module.httpx, "AsyncClient", _fake_async_client)
    client = ObjectDetectionApiClient(base_url="https://localhost:443/api")
    client._ensure_client()

    assert captured["verify"] is False


def test_api_client_verify_uses_ca_bundle_path(monkeypatch):
    captured: dict = {}

    def _fake_async_client(*args, **kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(od_api_client_module.httpx, "AsyncClient", _fake_async_client)
    client = ObjectDetectionApiClient(
        base_url="https://localhost:443/api",
        tls_verify=True,
        tls_ca_bundle="/tmp/od-ca.pem",
    )
    client._ensure_client()

    assert captured["verify"] == "/tmp/od-ca.pem"
