<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# System Requirements

This page summarizes the environment for running Virtual Security Guard. VSG
itself is light: one nginx container capped at 1 CPU and 256 MB of memory.
Most of the compute is in VSS and in the model that Hermes uses.

## Hardware Platforms used for validation

- VSS and the model server (OVMS) on Intel® Xeon® or Intel® Core™ Ultra
  platforms, as supported by VSS.
- The VSG container can run on the VSS host or on any host that reaches both
  Hermes and VSS.

## Operating Systems used for validation

- Ubuntu 24.04 LTS.

## Minimum Requirements (VSG container only)

| **Component** | **Minimum** | **Recommended** |
|---|---|---|
| **CPU** | 1 core | 2 cores |
| **Memory** | 256 MB | 512 MB |
| **Disk Space** | 1 GB (image) | 2 GB |

Sizing for VSS and the model server follows their own documentation.

## Software Requirements

- Docker Engine and Docker Compose:
  [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- GNU Make, to run the `make` targets: `sudo apt-get install -y make`.
- A VSS deployment with search enabled, the VSS MCP server, and indexed
  footage.
- A Hermes agent server with the API server enabled and the VSS MCP server
  registered.
- A modern Chromium-based or Firefox browser for the operator.
- Node.js 22 only for `make install`, `make dev`, `make dev-mock` and
  `make check` (UI development and tests). The image build does not need it.

## Network / Ports

| Port | Service | Notes |
|---|---|---|
| `12346` | VSG console (`VSG_UI_PORT`) | The only port the browser needs. |
| `8642` | Hermes API server | Reached by the VSG container only. |
| `12345` | VSS nginx gateway | Reached by the VSG container only. |
| `8000` | VSS MCP server | Reached by Hermes only. |

## Validation

Proceed to [Get Started](../get-started.md) once Docker is installed and both
`HERMES_BASE_URL/health` and `VSS_BASE_URL/manager/health` respond from the
VSG host.
