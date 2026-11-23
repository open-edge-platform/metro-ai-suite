# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Prepare the opt-in vehicle ReID model and pipeline configuration."""

import argparse
import hashlib
import json
from pathlib import Path
import tempfile

MODEL_SHA256 = "38d295c5c462877ca1e1e3fa3219557cc2a398c24cc7f15d53d840c5b5c05e53"
MODEL_PATH = "/home/pipeline-server/models/vehicle_reid/model.xml"
CONVERTER = " ! gvametaconvert "
INFERENCE = (
  " ! gvainference model=" + MODEL_PATH +
  " device=CPU inference-region=roi-list object-class=vehicle nireq=1"
)


def build_config(config):
  """Return a config with vehicle embeddings enabled for every pipeline."""
  pipelines = config.get("config", {}).get("pipelines", [])
  if not pipelines:
    raise ValueError("No pipelines found in the intersection configuration")
  for pipeline in pipelines:
    description = pipeline.get("pipeline", "")
    if description.count(CONVERTER) != 1 or "add-tensor-data=true" not in description:
      raise ValueError(f"Unsupported metadata pipeline: {pipeline.get('name')}")
    camera = pipeline["payload"]["parameters"]["camera_config"]
    if camera.get("metadatagenpolicy") != "detectionPolicy":
      raise ValueError(f"Unexpected metadata policy: {pipeline.get('name')}")
    pipeline["pipeline"] = description.replace(CONVERTER, INFERENCE + CONVERTER, 1)
    camera["metadatagenpolicy"] = "reidPolicy"
  return config


def prepare_model(source, destination):
  """Convert the pinned ONNX model to an OpenVINO IR with RGB normalization."""
  import openvino as ov

  model = ov.Core().read_model(str(source))
  model.reshape({model.input(0): [1, 3, 256, 256]})
  preprocessor = ov.preprocess.PrePostProcessor(model)
  preprocessor.input().tensor().set_element_type(ov.Type.u8).set_layout(
    ov.Layout("NHWC")).set_color_format(ov.preprocess.ColorFormat.BGR)
  preprocessor.input().model().set_layout(ov.Layout("NCHW"))
  preprocessor.input().preprocess().convert_color(
    ov.preprocess.ColorFormat.RGB).convert_element_type(ov.Type.f32).mean(
      [123.675, 116.28, 103.53]).scale([58.395, 57.12, 57.375])
  ov.save_model(preprocessor.build(), str(destination), compress_to_fp16=False)


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("model", type=Path, help="Pinned vehicle ReID ONNX file")
  parser.add_argument("config", type=Path, help="Original Smart Intersection config.json")
  parser.add_argument("output", type=Path, help="Output directory for model and config")
  args = parser.parse_args()

  with args.model.open("rb") as model_file:
    digest = hashlib.file_digest(model_file, "sha256").hexdigest()
  if digest != MODEL_SHA256:
    raise ValueError("Vehicle ReID model SHA-256 does not match the pinned artifact")
  with args.config.open(encoding="utf-8") as config_file:
    config = build_config(json.load(config_file))

  args.output.mkdir(parents=True, exist_ok=True)
  names = ("model.xml", "model.bin", "config.json")
  if any((args.output / name).exists() for name in names):
    raise FileExistsError("Output files already exist; choose an empty output directory")
  with tempfile.TemporaryDirectory(dir=args.output) as temporary:
    temporary = Path(temporary)
    prepare_model(args.model, temporary / "model.xml")
    with (temporary / "config.json").open("w", encoding="utf-8") as config_file:
      json.dump(config, config_file, indent=2)
      config_file.write("\n")
    for name in names:
      (temporary / name).rename(args.output / name)
  print(f"Prepared vehicle ReID files in {args.output}")


if __name__ == "__main__":
  main()