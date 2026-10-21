<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# System Requirements

VSG itself is light. Most of the compute is in VSS and in the model Hermes
uses; size those from their own documentation.

## Validated Platforms

- **Hardware**: VSS and the model server (OVMS) on Intel® Xeon® or Intel®
  Core™ Ultra platforms, as supported by VSS. The VSG container can run on the
  VSS host or on any host that reaches both Hermes and VSS.
- **Reasoning model**: `OpenVINO/Qwen3.8-27B-int4-ov` on OVMS. The weights are
  about 15 GB. The GPU (for an integrated GPU, system memory) needs room for
  them, the KV cache, and any VSS models on the same host.
- **Operating system**: Ubuntu 24.04 LTS.

## VSG Container

| Resource | Value |
|---|---|
| CPU | 1 core (Compose limit) |
| Memory | 256 MB (Compose limit) |
| Disk | About 120 MB for the image; allow 1 GB to build it locally. |

## Software

- Docker Engine with the Compose plugin:
  [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- GNU Make: `sudo apt-get install -y make`.
- A VSS deployment with search enabled, the VSS MCP server, and indexed
  footage.
- A Hermes agent server with the API server enabled and the VSS MCP server
  registered. [Set Up Hermes and OVMS](./set-up-hermes.md) installs Hermes,
  OVMS and the Inference Router with agent-harness-install.
- A current Chromium-based browser or Firefox.
- Node.js 22, only for UI development and tests (`make install`, `make dev`,
  `make dev-mock`, `make check`). The image build does not need it.

## Network Ports

| Port | Service | Reached by |
|---|---|---|
| `12346` | VSG console (`VSG_UI_PORT`) | The browser (the only port it needs). |
| `8642` | Hermes API server | The VSG container. |
| `12345` | VSS nginx gateway | The VSG container. |
| `8000` | VSS MCP server | Hermes. |
| `8010` | Inference Router (`127.0.0.1` only) | Hermes, on the same host. |
| `8000` or `HARNESS_OVMS_REST_PORT` | OVMS (`127.0.0.1` only) | The Inference Router. Change it if the VSS MCP server uses `8000` on the same host. |

Before you continue to [Get Started](../get-started.md), check that
`HERMES_BASE_URL/health` and `VSS_BASE_URL/manager/health` respond from the
VSG host.
