<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Virtual Security Guard

This application deploys **Virtual Security Guard (VSG)**, an operator console
for **Argus**, an AI security agent that runs on a Hermes agent server. Argus
searches recorded and live camera footage through Intel® Video Search and
Summarization (VSS), and VSG renders what Argus finds: match grids for human
review, a floorplan route, live camera matches, and PDF incident reports.

![Argus investigation in Virtual Security Guard](./docs/user-guide/_assets/argus-search-results.jpg)

## Get Started

To see the system requirements and other installations, see the following guides:

- [System Requirements](./docs/user-guide/get-started/system-requirements.md): Check the hardware and software requirements for deploying the application.
- [Get Started](./docs/user-guide/get-started.md): Follow step-by-step instructions to set up the application.

## How It Works

The operator talks to Argus in the browser. Argus reasons with a local model,
calls VSS search and watch tools through the VSS MCP server, and the single
VSG container serves the React console while proxying an allowlist of Hermes
and VSS routes. The operator reviews ranked matches, crops and re-searches,
builds a floorplan route, optionally watches live cameras, and exports a PDF
incident report.

For more information see [How it works](./docs/user-guide/how-it-works.md)

## Learn More

- [Overview](./docs/user-guide/index.md)
- [Quick start guide](./docs/user-guide/quick-start-guide.md)
- [System Requirements](./docs/user-guide/get-started/system-requirements.md)
- [Get Started](./docs/user-guide/get-started.md)
- [How to Guides](./docs/user-guide/how-to-guides.md)
- [API Reference](./docs/user-guide/api-reference.md)
- [How to Build Source](./docs/user-guide/get-started/build-from-source.md)
- [Known Issues](./docs/user-guide/known-issues.md)
- [Release Notes](./docs/user-guide/release-notes.md)