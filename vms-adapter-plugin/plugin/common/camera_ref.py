# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Codec that makes a camera reference safe for use as one MQTT topic level.

Some VMS vendors (e.g. Milestone) use ``{deviceId}/{streamId}`` as the camera
identifier. A ``/`` would add topic levels and break ``{prefix}/+`` filters, so
it is mapped to ``~`` on the wire. References without ``/`` (e.g. Nx) are
returned unchanged.
"""

_SEP = "/"
_WIRE_SEP = "~"


def encode(camera_ref: str) -> str:
    """Return *camera_ref* with ``/`` replaced so it forms a single topic level."""
    return camera_ref.replace(_SEP, _WIRE_SEP)


def decode(topic_level: str) -> str:
    """Inverse of :func:`encode`."""
    return topic_level.replace(_WIRE_SEP, _SEP)
