# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for MqttSubscriber (object detection metadata + loiterstatus bookmarks)."""

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

    mock_vms_shim.push_analytics_objects.assert_called_once()
    device_id, objects, _ts = mock_vms_shim.push_analytics_objects.call_args.args
    assert device_id == "cam1"
    assert len(objects) == 1


async def test_handle_message_ignores_unknown_vms(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    payload = json.dumps({"objects": []}).encode()

    await subscriber._handle_message("object_tracking/frigate:cam1", payload, shim_map)

    mock_vms_shim.push_analytics_objects.assert_not_called()


async def test_handle_message_ignores_malformed_topic(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_message("not/a/valid/topic/shape", b"{}", shim_map)
    mock_vms_shim.push_analytics_objects.assert_not_called()


async def test_handle_message_ignores_topic_missing_vendor_colon(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_message("object_tracking/cam1", b"{}", shim_map)
    mock_vms_shim.push_analytics_objects.assert_not_called()


# ── _handle_loiterstatus_message (LD app's dedicated threshold-crossing topic) ─

def _row(track_id=7, type_="pedestrian", zone="region1", dwell=6.2) -> bytes:
    return json.dumps({
        "Stream": "cam1",
        "Track ID": track_id,
        "Type": type_,
        "Zone": zone,
        "Dwell Time (s)": dwell,
    }).encode()


async def test_loiterstatus_pushes_bookmark_for_every_message(mock_vms_shim):
    """No dedup/cooldown - every row on the topic is bookmarked, pure pass-through."""
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_loiterstatus_message("object_tracking/nx:cam1/loiterstatus", _row(), shim_map)

    mock_vms_shim.set_bookmark.assert_called_once()
    camera_id, timestamp, label = mock_vms_shim.set_bookmark.call_args.args
    assert camera_id == "nx:cam1"
    assert isinstance(timestamp, datetime)
    assert "7" in label and "region1" in label


async def test_loiterstatus_pushes_bookmark_on_every_repeated_message(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_loiterstatus_message("object_tracking/nx:cam1/loiterstatus", _row(), shim_map)
    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam1/loiterstatus", _row(dwell=7.5), shim_map,
    )
    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam1/loiterstatus", _row(dwell=8.1), shim_map,
    )

    assert mock_vms_shim.set_bookmark.call_count == 3


async def test_loiterstatus_distinguishes_tracks_and_cameras(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}

    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id=1), shim_map,
    )
    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam1/loiterstatus", _row(track_id=2), shim_map,
    )
    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam2/loiterstatus", _row(track_id=1), shim_map,
    )

    assert mock_vms_shim.set_bookmark.call_count == 3


async def test_loiterstatus_skips_shim_without_set_bookmark():
    subscriber = MqttSubscriber()

    class _NoBookmarkShim:
        pass

    shim_map = {"nx-main": _NoBookmarkShim()}
    # Should not raise even though the shim has no set_bookmark method.
    await subscriber._handle_loiterstatus_message("object_tracking/nx:cam1/loiterstatus", _row(), shim_map)


async def test_loiterstatus_ignores_malformed_topic(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_loiterstatus_message("object_tracking/loiterstatus", _row(), shim_map)
    mock_vms_shim.set_bookmark.assert_not_called()


async def test_loiterstatus_ignores_unparseable_payload(mock_vms_shim):
    subscriber = MqttSubscriber()
    shim_map = {"nx-main": mock_vms_shim}
    await subscriber._handle_loiterstatus_message(
        "object_tracking/nx:cam1/loiterstatus", b"not json", shim_map,
    )
    mock_vms_shim.set_bookmark.assert_not_called()
