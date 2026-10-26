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
    default_zone = [[0.0, 0.2778], [0.2344, 0.2778], [0.2344, 0.5556], [0.0, 0.5556]]
    cfg = _make_config(default_zone_polygon=default_zone)
    controls = cfg.control_params()
    zone = next(c for c in controls if c["name"] == "zone")
    assert zone["type"] == "text"
    assert "normalized" in zone["description"].lower()
    default_points = json.loads(zone["default"])
    assert default_points == default_zone


def test_control_params_zone_default_empty_when_unconfigured():
    cfg = _make_config()
    controls = cfg.control_params()
    zone = next(c for c in controls if c["name"] == "zone")
    assert json.loads(zone["default"]) == []


# ── zones config ──────────────────────────────────────────────────────────────

def test_object_categories_exclude_zone_when_no_zones():
    cfg = _make_config(label_map={"pedestrian": "person", "person": "person"})
    assert cfg.object_categories() == ["person"]


def test_object_categories_include_zone_when_zones_configured():
    cfg = _make_config(
        label_map={"pedestrian": "person"},
        zones={"region1": {"bounding_box": [0.0, 0.0, 0.5, 0.5]}},
    )
    assert cfg.object_categories() == ["person", "zone"]


def test_deprecated_label_type_map_merges_into_label_map():
    cfg = _make_config(
        label_type_map={"car": "vap.vehicle", "person": "vap.person"},
        label_map={"person": "human"},
    )
    assert cfg.label_map == {"car": "vap.vehicle", "person": "human"}


def test_zones_bounding_box_normalized_to_tuple():
    cfg = _make_config(zones={"region1": {"bounding_box": [0, 0.2, 0.3, 0.4]}})
    assert cfg.zones["region1"]["bounding_box"] == (0.0, 0.2, 0.3, 0.4)


def test_zone_missing_bounding_box_raises():
    with pytest.raises(ValueError, match="bounding_box"):
        _make_config(zones={"region1": {"label": "Zone"}})


def test_zone_filter_enabled_defaults_false():
    cfg = _make_config()
    assert cfg.zone_filter_enabled is False


def test_event_config_defaults():
    cfg = _make_config()
    assert cfg.events_enabled is False
    assert cfg.event_bookmark_enabled is False
    assert cfg.event_topic_suffix == "loiterstatus"


def test_deprecated_event_bookmark_enabled_enables_events():
    assert _make_config(event_bookmark_enabled=True).events_enabled is True
    assert _make_config(events_enabled=True).events_enabled is True


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


def test_milestone_camera_ref_is_single_topic_level_and_round_trips():
    from plugin.common import camera_ref

    shim = _make_shim(metadata_topic_prefix="object_tracking")
    ref = "milestone:dev-guid/stream-guid"
    topic = shim._build_mqtt_topic(ref)
    assert topic == "object_tracking/milestone:dev-guid~stream-guid"
    assert len(topic.split("/")) == 2
    assert camera_ref.decode(topic.split("/")[-1]) == ref
    assert camera_ref.encode("nx:abc123") == "nx:abc123"


_DLS_PAYLOAD = json.dumps({
    "objects": [{
        "detection": {
            "bounding_box": {"x_min": 0.1, "y_min": 0.2, "x_max": 0.3, "y_max": 0.4},
            "confidence": 0.9, "label": "person",
        },
        "id": 7,
    }],
    "rtp": {"sender_ntp_unix_timestamp_ns": 1_000_000_000},
}).encode()


@pytest.mark.asyncio
async def test_subscriber_decodes_milestone_topic_and_publishes_neutral_frame():
    from analytics_app_shim.object_detection.mqtt_subscriber import MqttSubscriber
    from plugin.base.interfaces import DetectionPublishContext

    vms = MagicMock()
    vms.publish_detections = AsyncMock(return_value=True)
    ctx = DetectionPublishContext(app_id="ld")
    await MqttSubscriber()._handle_message(
        "object_tracking/milestone:dev~stream", _DLS_PAYLOAD,
        {"milestone": vms}, timestamp_offset_ms=-100, publish_context=ctx,
    )
    camera_id, frame, passed_ctx = vms.publish_detections.await_args.args
    assert camera_id == "milestone:dev/stream"
    assert passed_ctx is ctx
    assert frame.timestamp_ms == 900
    assert frame.objects[0].track_id == 7
    assert frame.objects[0].label == "person"


# ── per-camera zone: resolution lookup + normalized->pixel translation ────────

def _camera_with_resolution(resolution: str = "1280x720") -> Camera:
    from vms_shim.nxwitness.shim import _to_camera

    # Built by the real Nx mapping, so these tests also cover bitrateInfos parsing.
    return _to_camera({
        "id": "{abc123}", "name": "cam", "status": "Online",
        "options": {"bitrateInfos": [{"encoderIndex": "primary", "resolution": resolution}]},
    })


def test_nx_camera_resolution_from_bitrate_info():
    from vms_shim.nxwitness.shim import _to_camera

    cam = _camera_with_resolution("1920x1080")
    assert (cam.camera_id, cam.width, cam.height) == ("nx:abc123", 1920, 1080)
    missing = _to_camera({"id": "x", "options": {"bitrateInfos": [{"resolution": "bad"}]}})
    assert (missing.width, missing.height) == (None, None)


def _vms_shim_set(name: str, vms_shim) -> VmsShimSet:
    return VmsShimSet(name=name, config=MagicMock(), vms_shim=vms_shim)


def test_lookup_vms_shim_exact_and_prefix_match(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    assert shim._lookup_vms_shim("nx:abc123") is mock_vms_shim


def test_lookup_vms_shim_none_when_no_colon():
    shim = _make_shim()
    assert shim._lookup_vms_shim("abc123") is None


async def test_get_camera_resolution_reads_neutral_fields(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution("1920x1080"))

    resolution = await shim._get_camera_resolution("nx:abc123")

    assert resolution == (1920, 1080)


async def test_get_camera_resolution_works_for_milestone(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("milestone", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=Camera(
        camera_id="milestone:dev/stream", name="cam", vendor="milestone", width=1920, height=1080,
    ))
    assert await shim._get_camera_resolution("milestone:dev/stream") == (1920, 1080)

    mock_vms_shim.get_camera_metadata.return_value = Camera(
        camera_id="milestone:dev/stream", name="cam", vendor="milestone",
    )
    assert await shim._get_camera_resolution("milestone:dev/stream") is None


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
    # Pipeline does not declare roi-properties, so no ROI is sent.
    assert "roi-properties" not in sent_payload["parameters"]


_ROI_ZONE = "[[0.0, 0.277778], [0.234375, 0.277778], [0.234375, 0.555556], [0.0, 0.555556]]"


@pytest.mark.parametrize(("resolution", "roi"), [
    ("1280x720", "0,200,300,400"),    # identical to the pipeline's gvaattachroi default
    ("1920x1080", "0,300,450,600"),   # scaled for the AXIS stream
])
async def test_start_sends_scaled_roi_to_pipelines_that_declare_it(mock_vms_shim, resolution, roi):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution(resolution))
    shim._api.list_pipelines = AsyncMock(return_value=[
        {"name": "user_defined_pipelines", "version": "vap_object_tracking_gpu",
         "parameters": {"properties": {"analytics-properties": {}, "roi-properties": {}}}},
        {"name": "user_defined_pipelines", "version": "object_tracking_gpu",
         "parameters": {"properties": {"analytics-properties": {}}}},
    ])
    await shim.fetch_schema()
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})

    for pipeline, expect_roi in (("vap_object_tracking_gpu", True), ("object_tracking_gpu", False)):
        params = MagicMock()
        params.model_dump.return_value = {
            "pipeline_name": pipeline, "camera_id": "rtsp://cam/s",
            "camera_id_ref": "nx:abc123", "zone": _ROI_ZONE, "parameters": {},
        }
        await shim.start(params)
        sent = shim._api.start_run.call_args.args[2]["parameters"]
        assert "zones" in sent["analytics-properties"]
        assert sent.get("roi-properties") == ({"roi": roi} if expect_roi else None)


async def test_start_sends_no_roi_without_zone(mock_vms_shim):
    shim = _make_shim()  # no default_zone_polygon configured
    shim._pipeline_parameters = {"vap_object_tracking_gpu": {"roi-properties"}}
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})
    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "vap_object_tracking_gpu", "camera_id": "rtsp://cam/s",
        "camera_id_ref": "nx:abc123", "zone": "", "parameters": {},
    }
    await shim.start(params)
    # Pipeline keeps its own default roi when no zone is given or configured.
    assert "roi-properties" not in shim._api.start_run.call_args.args[2]["parameters"]


async def test_start_without_zone_uses_configured_default_zone(mock_vms_shim):
    shim = _make_shim(default_zone_polygon=[[0.0, 0.277778], [0.234375, 0.277778],
                                            [0.234375, 0.555556], [0.0, 0.555556]])
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution("1920x1080"))
    shim._pipeline_parameters = {"vap_object_tracking_gpu": {"roi-properties"}}
    shim._api.start_run = AsyncMock(return_value={"instance_id": "abc123"})
    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "vap_object_tracking_gpu", "camera_id": "rtsp://cam/s",
        "camera_id_ref": "nx:abc123", "parameters": {},  # caller sent no zone
    }
    await shim.start(params)
    sent = shim._api.start_run.call_args.args[2]["parameters"]
    assert sent["roi-properties"] == {"roi": "0,300,450,600"}
    assert json.loads(sent["analytics-properties"]["zones"])[0]["points"][2] == {"x": 450, "y": 600}


async def test_schema_zone_default_comes_from_config():
    polygon = [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]]
    shim = _make_shim(default_zone_polygon=polygon)
    shim._api.list_pipelines = AsyncMock(return_value=[])
    schema = await shim.fetch_schema()
    assert json.loads(schema["properties"]["zone"]["default"]) == polygon

    bare = _make_shim()
    bare._api.list_pipelines = AsyncMock(return_value=[])
    assert (await bare.fetch_schema())["properties"]["zone"]["default"] == ""


def test_zone_roi_is_bounding_rectangle_of_polygon():
    points = [{"x": 10, "y": 50}, {"x": 90, "y": 20}, {"x": 60, "y": 120}]
    assert ObjectDetectionAnalyticsAppShim._zone_roi(points) == "10,20,90,120"


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


# ── run listing tags each active run with its camera, device and zone ───────

async def test_list_runs_tags_active_runs_from_their_detail(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("milestone", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=Camera(
        camera_id="milestone:dev/stream", name="c", vendor="milestone", width=1920, height=1080,
    ))
    shim._api.list_runs = AsyncMock(return_value=[
        {"id": "r1", "state": "RUNNING"},
        {"id": "r2", "state": "ABORTED"},
        {"id": "r3", "state": "QUEUED"},
    ])
    zones = json.dumps([{"id": "vap_zone", "type": "polygon", "points": [
        {"x": 0, "y": 300}, {"x": 450, "y": 300}, {"x": 450, "y": 600}, {"x": 0, "y": 600}]}])
    details = {
        # where the Pipeline Server keeps the original request
        "r1": {"params": {"request": {
            "destination": {"metadata": {"topic": "object_tracking/milestone:dev~stream"}},
            "parameters": {"detection-properties": {"device": "GPU"},
                           "analytics-properties": {"zones": zones}},
        }}},
        # foreign topic: not one of VAP's camera runs
        "r3": {"request": {"destination": {"metadata": {"topic": "other/thing"}}}},
    }
    shim._api.get_run = AsyncMock(side_effect=lambda run_id: details.get(run_id))

    by_id = {r["id"]: r for r in await shim.list_runs()}

    assert by_id["r1"]["camera_id"] == "milestone:dev/stream"
    assert by_id["r1"]["device"] == "GPU"
    assert json.loads(by_id["r1"]["zone"]) == [[0, 0.2778], [0.2344, 0.2778], [0.2344, 0.5556], [0, 0.5556]]
    assert "camera_id" not in by_id["r2"]          # inactive runs are not looked up
    assert "camera_id" not in by_id["r3"]
    assert [c.args[0] for c in shim._api.get_run.await_args_list] == ["r1", "r3"]

    # Cached, including the negative result for r3
    shim._api.get_run.reset_mock()
    await shim.list_runs()
    shim._api.get_run.assert_not_called()

    # Runs that are no longer active are forgotten
    shim._api.list_runs = AsyncMock(return_value=[{"id": "r1", "state": "COMPLETED"}])
    await shim.list_runs()
    assert shim._run_info == {}


async def test_started_run_is_listed_with_its_zone_without_lookup(mock_vms_shim):
    shim = _make_shim()
    shim._vms_shim_sets = [_vms_shim_set("nx-main", mock_vms_shim)]
    mock_vms_shim.get_camera_metadata = AsyncMock(return_value=_camera_with_resolution("1280x720"))
    shim._api.start_run = AsyncMock(return_value={"instance_id": "r9"})
    params = MagicMock()
    params.model_dump.return_value = {
        "pipeline_name": "p", "camera_id": "rtsp://cam/s", "camera_id_ref": "nx:abc123",
        "device": "", "zone": "[[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]", "parameters": {},
    }
    await shim.start(params)
    shim._api.list_runs = AsyncMock(return_value=[{"id": "r9", "state": "RUNNING"}])
    shim._api.get_run = AsyncMock()

    run = (await shim.list_runs())[0]
    assert run["camera_id"] == "nx:abc123"
    assert json.loads(run["zone"]) == [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]
    shim._api.get_run.assert_not_called()

    shim._api.stop_run = AsyncMock(return_value=True)
    await shim.stop_run("r9")
    assert "r9" not in shim._run_info
