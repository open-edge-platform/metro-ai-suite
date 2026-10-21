<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Get Started

VSG is one container that serves the console and proxies two upstreams: the
**Hermes** agent API (where Argus runs) and the **VSS** gateway. It has no
backend or database of its own.

## Prerequisites

- A host that meets the [System Requirements](./get-started/system-requirements.md),
  with [Docker](https://docs.docker.com/engine/install/) (Compose plugin) and
  GNU Make (`sudo apt-get install -y make`).
- A running **VSS** deployment with search, the VSS MCP server, and indexed
  footage (recorded videos or live RTSP streams).
- A **Hermes** agent server with the model served on OVMS, set up as
  described in [Set Up Hermes and OVMS](./get-started/set-up-hermes.md): API
  server enabled with an auth key, VSS MCP server registered, and Argus as the
  only skill.

## Run the Application

### 1. Get the source

```bash
git clone --filter=blob:none --sparse --branch main https://github.com/open-edge-platform/metro-ai-suite.git
cd metro-ai-suite
git sparse-checkout set virtual-security-guard-agent
cd virtual-security-guard-agent
```

All later commands run from this directory.

### 2. Create `deploy/.env`

```bash
cp deploy/.env.example deploy/.env
```

| Variable | Default | Purpose |
|---|---|---|
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Hermes API server, `scheme://host:port`, no path. Use the Hermes host's IP: inside the container, `127.0.0.1` is the container itself. |
| `HERMES_API_KEY` | *(required)* | Hermes `API_SERVER_KEY` from `~/.hermes/.env`. nginx adds it to Hermes requests. |
| `VSS_BASE_URL` | `http://127.0.0.1:12345` | VSS nginx gateway (serves `/manager` and `/datastore`). |
| `VSG_FLOORPLAN` | `simple` | Default floorplan: `deploy/floorplans/<name>.json`, mounted into the container. Ships with `simple` (`camera_1`…`camera_4`) and `level4`. See [Configure the Floorplan](./how-to-guides/configure-floorplan.md). |
| `VSG_UI_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep the console local. |
| `VSG_UI_PORT` | `12346` | Console port. |

`REGISTRY` and `TAG` select the image; with `make`, pass them as arguments
(see [Build from Source](./get-started/build-from-source.md)).

> [!IMPORTANT]
> `deploy/.env` holds the Hermes API key. It is gitignored; never commit it.

If your network uses a proxy, add the Hermes and VSS hosts to `no_proxy`.

### 3. Install the Argus skills on the Hermes host

On the Hermes host, install Argus and move every other Hermes skill aside:

```bash
make install-skills INSTALL_ARGS=--exclusive
hermes skills list   # only virtual-security-guard and vsg-incident-report
```

If you followed [Set Up Hermes and OVMS](./get-started/set-up-hermes.md), you
already did this in its last step. See
[Install the Hermes Skills](./get-started/install-hermes-skills.md).

### 4. Build and start

```bash
make build
make up
```

`make up` starts the existing `intel/vsg-ui` image and does not rebuild it;
run `make build` again after code changes. Follow logs with `make logs`.

### 5. Check the connections

```bash
for u in /healthz /hermes/health /vss/manager/health; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:12346$u)"
done
```

All three must return `200`. The sidebar footer also shows **Hermes**
and **VSS** as **Reachable**.

### 6. Run a search

Open `http://<HOST_IP>:12346/argus`, then:

1. Describe the person, attach a photo, or both. Optionally name cameras or a
   time range in the text.
2. Send. Argus replies with a grid of potential matches.
3. Play a clip, **Confirm** the sightings that show the subject, and send the
   review.
4. Continue from the chat: crop and re-search, start a live camera search, or
   generate a report. The route appears on the **Floorplan** page.

See [Investigate a Person](./how-to-guides/investigate-a-person.md) for the
full walkthrough.

### 7. Stop

```bash
make down
```

## Next Steps

- [Build from Source](./get-started/build-from-source.md)
- [Run Unit Tests](./get-started/run-unit-tests.md)
- [How-to Guides](./how-to-guides.md)
- [Known Issues](./known-issues.md)

<!--hide_directive
:::{toctree}
:hidden:

./get-started/system-requirements.md
./get-started/set-up-hermes.md
./get-started/install-hermes-skills.md
./get-started/build-from-source.md
./get-started/run-unit-tests.md

:::
hide_directive-->
