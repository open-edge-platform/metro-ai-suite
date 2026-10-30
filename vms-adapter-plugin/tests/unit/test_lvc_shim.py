# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the LVC caption write-back to VMS shims."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from analytics_app_shim.lvc.config import LiveCaptioningAnalyticsAppConfig
from analytics_app_shim.lvc.shim import LiveCaptioningAnalyticsAppShim


def _vms(prefix: str, ok: bool = True):
    return SimpleNamespace(
        camera_id_prefix=prefix,
        publish_event=AsyncMock(return_value=ok),
    )


def _shim(*vms):
    shim = LiveCaptioningAnalyticsAppShim(LiveCaptioningAnalyticsAppConfig(base_url="http://lvc"))
    shim.set_vms_shims([SimpleNamespace(vms_shim=v) for v in vms])
    return shim


@pytest.mark.asyncio
async def test_caption_goes_to_matching_vms_only():
    nx, milestone = _vms("nx:"), _vms("milestone:")
    shim = _shim(nx, milestone)
    shim.register_run("r1", "milestone:dev/stream")

    await shim._publish_caption("r1", "a caption")

    nx.publish_event.assert_not_called()
    camera_id, event = milestone.publish_event.call_args.args
    assert camera_id == "milestone:dev/stream"
    assert (event.text, event.app_id, event.run_id) == ("a caption", "live_captioning", "r1")


@pytest.mark.asyncio
async def test_caption_for_unknown_run_or_failure_is_ignored():
    nx = _vms("nx:")
    nx.publish_event.side_effect = RuntimeError("boom")
    shim = _shim(nx)

    await shim._publish_caption("missing", "x")
    nx.publish_event.assert_not_called()

    shim.register_run("r1", "nx:cam")
    await shim._publish_caption("r1", "x")  # must not raise
    nx.publish_event.assert_awaited_once()
