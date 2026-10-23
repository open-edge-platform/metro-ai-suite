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
make up                      # uses the local image

# Custom registry and tag: pass the same values to each target
make build REGISTRY=registry.example.com/ TAG=2026.3.0
make push  REGISTRY=registry.example.com/ TAG=2026.3.0
make up    REGISTRY=registry.example.com/ TAG=2026.3.0
```

`make up` uses a local image before pulling one, so run `make build` after
code changes.

`REGISTRY` needs a trailing slash. `make push` builds before pushing.

## Other Targets

| Target | Does |
|---|---|
| `make down` / `make logs` | Stop the container / follow its logs. |
| `make install-skills` | Copy the Hermes skills (see [Install the Argus skills](./set-up-prerequisite-stack.md#5-install-the-argus-skills)). |
| `make clean` | Remove `ui/dist` and `ui/coverage`. |

For `lint`, `test`, `check` and `format`, see [Run Unit Tests](./run-unit-tests.md).
