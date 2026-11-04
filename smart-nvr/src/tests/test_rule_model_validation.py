# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
import pytest
from pydantic import ValidationError

from model.rule import Rule


BASE_RULE = {
    "id": "r1",
    "label": "vehicle",
    "action": "summarize",
}


@pytest.mark.parametrize(
    "overrides",
    [
        {"count": -1},
        {"duration_seconds": 0},
        {"near_miss_distance_m": -0.1},
        {"event_type": "invalid_type"},
        {"region_thresholds": {"vehicle": -1}},
    ],
)
def test_rule_model_rejects_invalid_values(overrides):
    with pytest.raises(ValidationError):
        Rule(**{**BASE_RULE, **overrides})


def test_rule_model_normalizes_event_type_to_lowercase():
    rule = Rule(**{**BASE_RULE, "event_type": "Dwell_Time"})
    assert rule.event_type == "dwell_time"
