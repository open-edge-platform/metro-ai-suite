# How to use NPU for inference

## Prerequisites

- NPU is available

## Configure and deploy NPU pipelines

In `metro-vision-ai-app-recipe/smart-corridor/src/dlstreamer-pipeline-server/`, the config files `config_child_1.json, config_child_2.json, config_parent.json, config_sn_parent.json` have the following GPU pipelines. Set `"auto_start": true` for respective pipelines.

- intersection4-cam1-npu
- intersection4-cam2-npu
- intersection4-cam3-npu
- intersection4-cam4-npu

- intersection5-cam1-npu
- intersection5-cam2-npu
- intersection5-cam3-npu
- intersection5-cam4-npu

- intersection9-cam1-npu
- intersection9-cam2-npu
- intersection9-cam3-npu
- intersection9-cam4-npu

Also, set `"auto_start": false` for the all other pipelines in the same configuration file.

Start the application with:
`docker compose up -d`
