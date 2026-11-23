# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import base64
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import types

import pytest

APP_DIR = Path(__file__).resolve().parents[1]
ADAPTER = APP_DIR / "src/dlstreamer-pipeline-server/user_scripts/gvapython/sscape/sscape_adapter.py"


def load_module(name, path):
  spec = importlib.util.spec_from_file_location(name, path)
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


@pytest.fixture
def adapter(monkeypatch):
  utils = types.ModuleType("utils")
  utils.publisher_utils = types.ModuleType("utils.publisher_utils")
  monkeypatch.setitem(sys.modules, "utils", utils)
  monkeypatch.setitem(sys.modules, "utils.publisher_utils", utils.publisher_utils)
  return load_module("intersection_adapter", ADAPTER)


def detection(label="vehicle", tensors=None):
  return {
    "x": 1, "y": 2, "w": 80, "h": 90,
    "detection": {
      "label": label, "confidence": 0.9,
      "bounding_box": {"x_min": 0.1, "y_min": 0.2, "x_max": 0.4, "y_max": 0.6},
    },
    "tensors": tensors or [],
  }


def test_vehicle_embedding_uses_tracker_contract(adapter):
  output = {}
  adapter.reidPolicy(output, detection(tensors=[
    {"tensor_name": "other", "data": [1.0]},
    {"tensor_name": "embedding", "data": [0.25] * 512},
  ]), 1000, 1000)
  reid = output["metadata"]["reid"]
  assert output["category"] == "vehicle"
  assert output["bounding_box_px"]["width"] == 80
  assert reid["embedding_dimensions"] == 512
  assert struct.unpack("<512f", base64.b64decode(reid["embedding_vector"])) == (0.25,) * 512


@pytest.mark.parametrize("label,vector", [
  ("pedestrian", [0.25] * 512),
  ("vehicle", []),
  ("vehicle", [0.25] * 511),
  ("vehicle", [math.nan] + [0.25] * 511),
  ("vehicle", [1e100] + [0.25] * 511),
])
def test_non_vehicle_or_invalid_embedding_stays_detection(adapter, label, vector):
  output = {}
  adapter.reidPolicy(output, detection(label, [{"tensor_name": "embedding", "data": vector}]),
                     1000, 1000)
  assert output["category"] == label
  assert "reid" not in output.get("metadata", {})


def test_prepare_config_enables_vehicle_reid_for_all_cameras():
  prepare = load_module("prepare_vehicle_reid", APP_DIR / "prepare_vehicle_reid.py")
  with (APP_DIR / "src/dlstreamer-pipeline-server/config.json").open(encoding="utf-8") as source:
    config = json.load(source)
  expected_names = {pipeline["name"] for pipeline in config["config"]["pipelines"]}
  config = prepare.build_config(config)
  pipelines = config["config"]["pipelines"]
  assert expected_names
  assert {pipeline["name"] for pipeline in pipelines} == expected_names
  for pipeline in pipelines:
    assert pipeline["pipeline"].count("object-class=vehicle") == 1
    assert pipeline["pipeline"].index("gvainference") < pipeline["pipeline"].index("gvametaconvert")
    assert pipeline["payload"]["parameters"]["camera_config"]["metadatagenpolicy"] == "reidPolicy"


def test_prepare_config_rejects_missing_or_incompatible_pipeline():
  prepare = load_module("prepare_vehicle_reid_invalid", APP_DIR / "prepare_vehicle_reid.py")
  with pytest.raises(ValueError, match="No pipelines"):
    prepare.build_config({"config": {"pipelines": []}})
  with pytest.raises(ValueError, match="Unsupported metadata pipeline"):
    prepare.build_config({"config": {"pipelines": [{"name": "bad", "pipeline": "fakesrc"}]}})