<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Build from Source

Run these `make` targets from the `virtual-security-guard-agent` application
directory. `make help` lists them all.

## Prerequisites

- GNU Make.
- Docker, for `make build`, `make up` and `make push`.
- Node.js 22, for `make install`, `make dev` and `make dev-mock`.

## Build the Image

`make build` builds `${REGISTRY}intel/vsg-ui:${TAG}` (default
`intel/vsg-ui:latest`) and passes your shell's proxy variables through.

```bash
make build
make up                      # reads deploy/.env

# Custom registry and tag: pass the same values to each target
make build REGISTRY=registry.example.com/ TAG=2026.3.0
make push  REGISTRY=registry.example.com/ TAG=2026.3.0
make up    REGISTRY=registry.example.com/ TAG=2026.3.0
```

`REGISTRY` needs a trailing slash. `make push` builds before pushing.

## Run the Dev Server

```bash
make install                 # once: npm ci
```

| Goal | Command | Needs |
|---|---|---|
| Offline UI work with a scripted Argus and VSS | `make dev-mock` | Nothing |
| UI against real Hermes and VSS | `make dev` | `ui/.env.local` |

Both serve on `http://localhost:5173`. For `make dev`, copy the template and
set the same upstreams as `deploy/.env`:

```bash
cp ui/.env.example ui/.env.local
```

The Vite dev proxy adds the Hermes key server-side; it is not bundled into the
browser code.

> [!IMPORTANT]
> `ui/.env.local` is gitignored. Never commit it.

## Other Targets

| Target | Does |
|---|---|
| `make down` / `make logs` | Stop the container / follow its logs. |
| `make install-skills` | Copy the Hermes skills (see [Install the Hermes Skills](./install-hermes-skills.md)). |
| `make clean` | Remove `ui/dist` and `ui/coverage`. |

For `lint`, `test`, `check` and `format`, see [Run Unit Tests](./run-unit-tests.md).
