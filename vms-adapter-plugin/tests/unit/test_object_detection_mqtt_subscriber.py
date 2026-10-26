# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for MqttSubscriber (object detection metadata + status events)."""

from __future__ import annotations

import json
from datetime import datetime

from analytics_app_shim.object_detection.mqtt_subscriber import MqttSubscriber


# ── _handle_message (raw metadata → Nx object push) ───────────────────────────

async def test_handle_message_pushes_objects_to_matching_shim(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    payload = json.dumps({
        "objects": [
            {
                "detection": {
                    "bounding_box": {"x_min": 0.1, "y_min": 0.1, "x_max": 0.2, "y_max": 0.2},
                    "confidence": 0.9,
                    "label": "pedestrian",
                },
                "id": 1,
            },
        ],
    }).encode()

    await subscriber._handle_message("object_tracking/nx:cam1", payload, shim_map)

    mock_vms_shim.publish_detections.assert_awaited_once()
    camera_id, frame, _ctx = mock_vms_shim.publish_detections.call_args.args
    assert camera_id == "nx:cam1"
    assert len(frame.objects) == 1


async def test_handle_message_ignores_unknown_vms(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    payload = json.dumps({"objects": []}).encode()

    await subscriber._handle_message("object_tracking/frigate:cam1", payload, shim_map)

    mock_vms_shim.publish_detections.assert_not_called()


async def test_handle_message_ignores_malformed_topic(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_message("not/a/valid/topic/shape", b"{}", shim_map)
    mock_vms_shim.publish_detections.assert_not_called()


async def test_handle_message_ignores_topic_missing_vendor_colon(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_message("object_tracking/cam1", b"{}", shim_map)
    mock_vms_shim.publish_detections.assert_not_called()


# ── _handle_status_event_message (app's dedicated threshold-crossing topic) ───

def _row(track_id=7, type_="pedestrian", zone="region1", dwell=6.2) -> bytes:
    return json.dumps({
        "Stream": "cam1",
        "Track ID": track_id,
        "Type": type_,
        "Zone": zone,
        "Dwell Time (s)": dwell,
    }).encode()


async def test_status_event_publishes_neutral_loitering_event(mock_vms_shim):
    """No dedup/cooldown - every row on the topic is published, pure pass-through."""
    from plugin.base.interfaces import DetectionPublishContext

    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(), shim_map,
        DetectionPublishContext(app_id="ld"),
    )

    mock_vms_shim.publish_event.assert_awaited_once()
    camera_id, event = mock_vms_shim.publish_event.call_args.args
    assert camera_id == "nx:cam1"
    assert event.kind == "loitering" and event.app_id == "ld"
    assert isinstance(event.timestamp, datetime)
    # Same text the Nx bookmark used before, so Nx output is unchanged
    assert event.text == "pedestrian 7 loitering 6.2s in zone region1"
    assert (event.label, event.track_id, event.zone, event.dwell_s) == ("pedestrian", 7, "region1", 6.2)
    assert event.objects == []  # no frame seen for this track yet


async def test_status_event_publishes_every_repeated_message(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_status_event_message("object_tracking/nx:cam1/loiterstatus", _row(), shim_map)
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(dwell=7.5), shim_map,
    )
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(dwell=8.1), shim_map,
    )

    assert mock_vms_shim.publish_event.await_count == 3


async def test_status_event_distinguishes_tracks_and_cameras(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id=1), shim_map,
    )
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id=2), shim_map,
    )
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam2/loiterstatus", _row(track_id=1), shim_map,
    )

    calls = [(c.args[0], c.args[1].track_id) for c in mock_vms_shim.publish_event.await_args_list]
    assert calls == [("nx:cam1", 1), ("nx:cam1", 2), ("nx:cam2", 1)]


def _frame(track_id: int, x: float = 0.1) -> bytes:
    return json.dumps({"metadata": {"objects": [{
        "id": track_id,
        "detection": {
            "bounding_box": {"x_min": x, "y_min": 0.2, "x_max": x + 0.1, "y_max": 0.6},
            "confidence": 0.8, "label": "pedestrian",
        },
    }]}}).encode()


async def test_status_event_attaches_latest_box_of_the_same_track(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"milestone": mock_vms_shim}
    topic = "object_tracking/milestone:dev~stream"

    await subscriber._handle_message(topic, _frame(7, x=0.1), shim_map)
    await subscriber._handle_message(topic, _frame(7, x=0.4), shim_map)
    await subscriber._handle_message(topic, _frame(9, x=0.7), shim_map)
    await subscriber._handle_status_event_message(f"{topic}/loiterstatus", _row(track_id=7), shim_map)
    # Same track id on another camera has no box
    await subscriber._handle_status_event_message(
        "object_tracking/milestone:other~cam/loiterstatus", _row(track_id=7), shim_map,
    )

    (cam, event), (other_cam, other_event) = (c.args for c in mock_vms_shim.publish_event.await_args_list)
    assert cam == "milestone:dev/stream"
    assert len(event.objects) == 1 and event.objects[0].x_min == 0.4
    assert other_cam == "milestone:other/cam" and other_event.objects == []


async def test_status_event_box_lookup_accepts_string_track_id_and_expires(mock_vms_shim, monkeypatch):
    from analytics_app_shim.object_detection import mqtt_subscriber as mod

    clock = [100.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: clock[0])
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_message("object_tracking/nx:cam1", _frame(7), shim_map)
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id="7"), shim_map,
    )
    clock[0] += mod._TRACK_BOX_TTL_S + 1
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id=7), shim_map,
    )

    fresh, stale = (c.args[1] for c in mock_vms_shim.publish_event.await_args_list)
    assert len(fresh.objects) == 1
    assert stale.objects == []


async def test_status_event_bookmark_on_nx_is_unchanged():
    """End to end with the real Nx shim: the bookmark label is exactly as before."""
    from unittest.mock import AsyncMock

    from plugin.core.config import VmsInstanceConfig
    from vms_shim.nxwitness.shim import NxWitnessVmsShim

    nx = NxWitnessVmsShim(VmsInstanceConfig(name="nx-main", vendor="nx_witness"))
    nx.set_bookmark = AsyncMock()
    await MqttSubscriber()._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", _row(), {"nx-main": nx},
    )

    camera_id, timestamp, label = nx.set_bookmark.await_args.args
    assert camera_id == "nx:cam1" and isinstance(timestamp, datetime)
    assert label == "pedestrian 7 loitering 6.2s in zone region1"


async def test_status_event_skips_shim_without_publish_event():
    subscriber = MqttSubscriber()

    class _NoEventShim:
        pass

    shim_map = {"nx-main": _NoEventShim()}
    # Should not raise even though the shim has no publish_event method.
    await subscriber._handle_status_event_message("object_tracking/nx:cam1/loiterstatus", _row(), shim_map)


async def test_status_event_ignores_malformed_topic(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_status_event_message("object_tracking/loiterstatus", _row(), shim_map)
    mock_vms_shim.publish_event.assert_not_called()


async def test_status_event_ignores_unparseable_payload(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", b"not json", shim_map,
    )
    await subscriber._handle_status_event_message(
        "object_tracking/nx:cam1/loiterstatus", b"[1, 2]", shim_map,
    )
    mock_vms_shim.publish_event.assert_not_called()
