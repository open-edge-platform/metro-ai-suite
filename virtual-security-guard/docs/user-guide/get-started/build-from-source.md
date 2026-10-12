<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Build from Source

This guide builds the `intel/vsg-ui` image and runs the UI dev servers with
the `make` targets in the application directory.

## Prerequisites

- GNU Make: `sudo apt-get install -y make`.
- Docker, for `make build`, `make up` and `make push`.
- Node.js 22, for `make install`, `make dev` and `make dev-mock`.

## Build the image

1. Go to the application directory:

   ```bash
   cd sample-applications/virtual-security-guard
   ```

2. Build the image (proxy variables from your shell are passed through):

   ```bash
   make build                       # intel/vsg-ui:latest
   make build REGISTRY=registry.example.com/ TAG=1.0.0
   ```

   Then start it (reads `deploy/.env`; pass the same `REGISTRY` and `TAG`):

   ```bash
   make up
   make up REGISTRY=registry.example.com/ TAG=1.0.0
   ```

3. Optionally push it:

   ```bash
   make push REGISTRY=registry.example.com/ TAG=1.0.0
   ```

## Run the dev server

Install dependencies once (Node.js 22):

```bash
make install
```

| Goal | Command | Needs |
|---|---|---|
| Offline UI work with scripted Argus and VSS | `make dev-mock` | nothing |
| Dev server against real Hermes and VSS | `make dev` | `ui/.env.local` |

For `make dev`, create `ui/.env.local` from the template and fill in the same
upstreams as `deploy/.env`. The Vite dev proxy adds the Hermes key; it is not
bundled into the browser code.

```bash
cp ui/.env.example ui/.env.local
```

> [!IMPORTANT]
> `ui/.env.local` is gitignored. Never commit it.

## Make targets

Run `make help` for the full list: `install`, `dev`, `dev-mock`, `lint`,
`format`, `test`, `check`, `build`, `push`, `up`, `down`, `logs`,
`install-skills`, `clean`.
