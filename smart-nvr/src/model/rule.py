# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
from typing import Dict

from pydantic import BaseModel, Field, field_validator


class Rule(BaseModel):
    id: str
    label: str
    action: str
    camera: str | None = None
    source: str | None = None
    count: int | None = Field(default=None, ge=0)
    region_id: str | None = None
    region_name: str | None = None
    scene_id: str | None = None
    broker_id: str | None = None
    region_thresholds: Dict[str, int] | None = None
    event_type: str | None = None
    duration_seconds: int | None = Field(default=None, gt=0)
    near_miss_distance_m: float | None = Field(default=None, gt=0)

    @field_validator("event_type")
    @classmethod
    def _validate_event_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        allowed = {"count", "dwell_time", "near_miss"}
        if normalized not in allowed:
            raise ValueError(f"event_type must be one of: {', '.join(sorted(allowed))}")
        return normalized

    @field_validator("region_thresholds")
    @classmethod
    def _validate_region_thresholds(
        cls, value: Dict[str, int] | None
    ) -> Dict[str, int] | None:
        if value is None:
            return None
        for label, threshold in value.items():
            if threshold < 0:
                raise ValueError(f"region_thresholds[{label}] must be non-negative")
        return value
