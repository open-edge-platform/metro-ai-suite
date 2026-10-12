<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Get Started

Virtual Security Guard is a single container that serves the React console and
proxies two upstreams: the **Hermes** agent API (where Argus runs) and the
**VSS** gateway (videos, search and clips). VSG has no backend or database of
its own.

This section shows how to:

- **Set up the application**: Point VSG at your Hermes and VSS hosts and
  install the Argus skills on Hermes.
- **Run the application**: Start the container and open the console.
- **Modify application parameters**: Change ports, image tags and
  investigation settings.

## Prerequisites

- Verify that your system meets the minimum requirements. See
  [System Requirements](./get-started/system-requirements.md).
- Install the Docker platform: [Installation Guide](https://docs.docker.com/engine/install/).
- Install GNU Make. All steps below use the `make` targets in the
  application directory:

  ```bash
  sudo apt-get update && sudo apt-get install -y make
  ```
- A running **VSS** deployment with the search pipeline, the VSS MCP server,
  and indexed footage (recorded videos or live RTSP streams).
- A running **Hermes** agent server with:
  - its API server enabled and an API key (`API_SERVER_KEY`);
  - the VSS MCP server registered as a tool server;
  - a model endpoint (for example OVMS serving Qwen3-VL-8B int4);
  - the two VSG skills installed. See
    [Install the Hermes Skills](./get-started/install-hermes-skills.md).

## Run the Application

### 1. Go to the application directory

```bash
cd sample-applications/virtual-security-guard
```

### 2. Create `deploy/.env`

```bash
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env`:

| Variable | Default | Purpose |
|---|---|---|
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Hermes API server, `scheme://host:port`, no path. |
| `HERMES_API_KEY` | *(empty, required)* | Hermes `API_SERVER_KEY`. nginx adds it to Hermes requests; it never reaches the browser. |
| `VSS_BASE_URL` | `http://127.0.0.1:12345` | VSS nginx gateway that serves `/manager` and `/datastore`. |
| `VSG_UI_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to keep the console local. |
| `VSG_UI_PORT` | `12346` | Port the console listens on. |
| `REGISTRY` | *(empty)* | Image registry prefix, with a trailing slash. With `make`, pass it as an argument: `make up REGISTRY=registry.example.com/`. |
| `TAG` | `latest` | Image tag for `intel/vsg-ui`. With `make`, pass it as an argument: `make up TAG=1.0.0`. |

> [!IMPORTANT]
> `deploy/.env` holds the Hermes API key. It is gitignored; never commit it.

### 3. Install the Argus skills on the Hermes host (one-time)

On the Hermes host, from this directory:

```bash
make install-skills HERMES_SKILLS_DIR=~/.hermes/skills/security
```

Start a new Hermes session afterwards so Argus picks the skills up. See
[Install the Hermes Skills](./get-started/install-hermes-skills.md).

### 4. Start the application

Build the image and start the container:

```bash
make build
make up
```

`make up` reads `deploy/.env` and starts the existing `intel/vsg-ui` image; it
does not rebuild. Run `make build` again after code changes. Follow the
container logs with `make logs`.

### 5. Check the connections

```bash
P=12346
for u in /healthz /hermes/health /vss/manager/health; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$P$u)"
done
```

All three must return `200`. The sidebar of the console also shows
**Hermes agent** and **VSS** as **Reachable**.

### 6. Use the console

Open:

```text
http://<HOST_IP>:12346/argus
```

Then:

1. Type a description of the person, drop a photo with the image button, or
   both. Optionally limit the search to some cameras (**All cameras**) or a
   time window (**Any time**).
2. Send. Argus searches VSS and replies with a grid of potential matches.
3. Click a thumbnail to play the clip. **Confirm** the sightings that show the
   subject and send the review.
4. Optionally crop the person from a clip to run a sharper image search.
5. Open **Floorplan** to see the route, start a live camera search, or ask
   Argus for a report.

A complete walkthrough with screenshots is in
[Investigate a Person](./how-to-guides/investigate-a-person.md).

If your network uses a proxy, add the Hermes and VSS hosts to `no_proxy` so
the container reaches them directly.

### 7. Stop the application

```bash
make down
```

## Advanced paths

- [Build from Source](./get-started/build-from-source.md)
- [Run Unit Tests](./get-started/run-unit-tests.md)
- [API Reference](./api-reference.md)
- [Known Issues](./known-issues.md)

<!--hide_directive
:::{toctree}
:hidden:

./get-started/system-requirements.md
./get-started/install-hermes-skills.md
./get-started/build-from-source.md
./get-started/run-unit-tests.md

:::
hide_directive-->
