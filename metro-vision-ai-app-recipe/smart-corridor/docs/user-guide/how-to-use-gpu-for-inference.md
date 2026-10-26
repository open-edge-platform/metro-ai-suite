# How to use GPU for inference

## Prerequisites

- GPU is available

## Configure and deploy GPU pipelines

In `metro-vision-ai-app-recipe/smart-corridor/src/dlstreamer-pipeline-server/`, the config files `config_child_1.json, config_child_2.json, config_parent.json, config_sn_parent.json` have the following GPU pipelines. Set `"auto_start": true` for respective pipelines.

- intersection4-cam1-gpu
- intersection4-cam2-gpu
- intersection4-cam3-gpu
- intersection4-cam4-gpu

- intersection5-cam1-gpu
- intersection5-cam2-gpu
- intersection5-cam3-gpu
- intersection5-cam4-gpu

- intersection9-cam1-gpu
- intersection9-cam2-gpu
- intersection9-cam3-gpu
- intersection9-cam4-gpu

Also, set `"auto_start": false` for the all other pipelines in the same configuration file.

Start the application with:
`docker compose up -d`

> **Note:** If you have multiple GPUs (integrated/discrete), please follow the [GPU Device Selection](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer/dev_guide/gpu_device_selection.html) DL Streamer document for selecting the GPU render device of your choice for VA codecs plugins.
