<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# API Reference

VSG has no API of its own. The `vsg-ui` container serves the console and
proxies an **allowlist** of Hermes and VSS routes. Any other path under
`/hermes/` or `/vss/` returns `403`. Ids in paths must match
`[A-Za-z0-9_.:-]{1,128}` (Hermes) or `[A-Za-z0-9_-]{1,128}` (VSS).

Base URL: `http://<HOST_IP>:12346`

## Gateway

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | Container liveness. Returns `ok`. |
| GET | `/argus`, `/cameras`, `/floorplan`, `/reports`, `/settings` | Console pages. `/argus?session=<id>` opens an investigation. |

## Hermes (`/hermes/*` → `HERMES_BASE_URL`)

nginx strips `/hermes` and adds `Authorization: Bearer <HERMES_API_KEY>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/hermes/health` | Hermes liveness. |
| POST | `/hermes/v1/runs` | Start an Argus run (one per operator turn). Rate limited. |
| GET | `/hermes/v1/runs/{id}` | Run status (fallback when the stream drops). |
| GET | `/hermes/v1/runs/{id}/events` | Run events as Server-Sent Events. |
| POST | `/hermes/v1/runs/{id}/stop` | Stop a run. |
| GET, POST | `/hermes/api/sessions` | List or create investigations. |
| GET, DELETE | `/hermes/api/sessions/{id}` | Read or delete an investigation. |
| GET | `/hermes/api/sessions/{id}/messages` | Transcript, used to ground matches in real tool results. |

## VSS (`/vss/*` → `VSS_BASE_URL`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/vss/manager/health` | VSS liveness. |
| GET | `/vss/manager/app/features` | VSS capabilities (search, image search, summary). |
| GET | `/vss/manager/tags` | Camera tags. |
| POST | `/vss/manager/search` | Create a watched query for live search. |
| GET | `/vss/manager/search/{id}` | Read a stored search and its results. |
| PATCH | `/vss/manager/search/{id}/watch` | Start or stop watching a query. |
| POST | `/vss/manager/search/images` | Upload a subject or crop image (max 3 MB). |
| GET, POST | `/vss/manager/streams` | List or add live RTSP cameras. |
| GET, PATCH, DELETE | `/vss/manager/streams/{id}` | Read, edit, pause or remove a camera. |
| GET | `/vss/manager/frames` | Best-frame JPEGs for match thumbnails. |
| GET | `/vss/datastore/video-summary/…`, `/vss/datastore/live-streams/…` | Clips and images, streamed. |

## Argus directive protocol

Argus replies with plain text plus fenced JSON blocks that the console turns
into widgets. Schemas: `ui/src/protocol/directives.ts`.

| Block | Direction | Renders as |
|---|---|---|
| `vsg-context` | UI → Argus | Subject image, cameras, time window. |
| `vsg-feedback` | UI → Argus | Confirmed / rejected match refs for one search. |
| `vsg-matches` | Argus → UI | Review grid. |
| `vsg-report` | Argus → UI | Editable report draft and PDF. |
| `vsg-status` | Argus → UI | Progress line. |
| `vsg-track` | Argus → UI | Legacy route block. |

For the Hermes endpoint details, see `docs/Hermes_API_Flow.md`.
